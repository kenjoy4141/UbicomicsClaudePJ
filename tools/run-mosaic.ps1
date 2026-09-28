<#
.SYNOPSIS
  AutoMosaicTool_Pro にフォルダを指定して実行し、完了まで待つ。

.DESCRIPTION
  このツールはCLI引数を持たないため、入出力フォルダは DirectoryData.txt に書き込み、
  「実行」ボタンは UIAutomation でクリックする。
  DirectoryData.txt は起動時に読まれるので、既に起動中の場合は -Force で再起動が必要。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\run-mosaic.ps1 `
    -InputDir "C:\Stable-Diffusion-install\stable-diffusion-webui\outputs\txt2img-images\2026-09-07" `
    -OutputDir "C:\Stable-Diffusion-install\stable-diffusion-webui\outputs\txt2img-images\2026-09-07moza"
#>
param(
    [Parameter(Mandatory = $true)][string]$InputDir,
    [Parameter(Mandatory = $true)][string]$OutputDir,
    [string]$ToolDir = "C:\Users\7700\Downloads\AutoMosaicToolPro\AutoMosaicToolPro\AutoMosaicTooPro",
    [int]$TimeoutMinutes = 15,
    [switch]$Force,
    [switch]$NoClick
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$exe      = Join-Path $ToolDir "AutoMosaicTool_Pro.exe"
$dataFile = Join-Path $ToolDir "DirectoryData.txt"
$procName = "AutoMosaicTool_Pro"

function Log($msg) {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg)
}

# --- 事前チェック -----------------------------------------------------------
if (-not (Test-Path $exe))      { throw "ツールが見つかりません: $exe" }
if (-not (Test-Path $InputDir)) { throw "入力フォルダがありません: $InputDir" }
if (-not (Test-Path $dataFile)) { throw "DirectoryData.txt がありません: $dataFile" }

$imgCount = @(Get-ChildItem -Path $InputDir -Include *.png,*.jpg,*.jpeg -File -Recurse).Count
if ($imgCount -eq 0) { throw "入力フォルダに画像がありません: $InputDir" }
Log "入力 $imgCount 枚: $InputDir"

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    Log "出力フォルダを作成: $OutputDir"
}

# --- 起動中なら止める（DirectoryData.txt は起動時に読まれるため）------------
$running = Get-Process -Name $procName -ErrorAction SilentlyContinue
if ($running) {
    if (-not $Force) {
        throw "$procName が起動中です。フォルダ指定は起動時に読まれるので、閉じてから実行してください（強制再起動する場合は -Force）。"
    }
    Log "起動中のツールを終了します（-Force）"
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# --- フォルダ指定を書き込む -------------------------------------------------
# 3行目(ColorMask)と4行目(リネーム入力値)は既存の値を維持する
$lines = @(Get-Content -Path $dataFile -Encoding UTF8)
$colorMask = if ($lines.Count -ge 3) { $lines[2] } else { Join-Path $ToolDir "ColorMask" }
$renameVal = if ($lines.Count -ge 4) { $lines[3] } else { "cg" }

$newLines = @($InputDir, $OutputDir, $colorMask, $renameVal)
Set-Content -Path $dataFile -Value $newLines -Encoding UTF8
Log "DirectoryData.txt を更新しました"

# --- 起動 -------------------------------------------------------------------
Log "ツールを起動します"
Start-Process -FilePath $exe -WorkingDirectory $ToolDir | Out-Null

$proc = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $proc = Get-Process -Name $procName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc -and $proc.MainWindowHandle -ne 0) { break }
}
if (-not $proc) { throw "ツールの起動を確認できませんでした" }
Start-Sleep -Seconds 3

# --- ウィンドウを取得 -------------------------------------------------------
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $proc.Id)

$win = $null
for ($i = 0; $i -lt 20; $i++) {
    $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($win) { break }
    Start-Sleep -Seconds 1
}
if (-not $win) { throw "ウィンドウを取得できませんでした" }
Log "ウィンドウ取得: $($win.Current.Name)"

# --- 「実行」ボタンを探して押す ---------------------------------------------
function Find-ButtonByName($root, $name) {
    $c1 = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button)
    $c2 = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $name)
    $and = New-Object System.Windows.Automation.AndCondition($c1, $c2)
    return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $and)
}

$btn = Find-ButtonByName $win "実行"
if (-not $btn) {
    throw "「実行」ボタンが見つかりません。tools\inspect-window.ps1 でUI構造を確認してください。"
}

if ($NoClick) {
    Log "-NoClick 指定のため、フォルダ指定だけして終了します。実行ボタンは手動で押してください。"
    exit 0
}

$invoke = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
Log "「実行」を押しました。完了まで待ちます..."

# --- 完了待ち（ステータス文字列を監視）-------------------------------------
# 例: "すべての画像のモザイク化 完了(1608枚)"
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$lastText = ""
$textCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text)

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5

    if (-not (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)) {
        throw "ツールが終了しました（処理中に落ちた可能性）"
    }

    $texts = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCond)
    $status = ""
    foreach ($t in $texts) {
        $n = $t.Current.Name
        if ($n -match "モザイク化") { $status = $n }
    }

    if ($status -and $status -ne $lastText) {
        Log "状態: $status"
        $lastText = $status
    }

    if ($status -match "完了") {
        # ツールは「完了」表示のあとも書き出しを続けていることがあるので、枚数が増えなくなるまで待つ
        $outCount = 0
        $stable = 0
        for ($w = 0; $w -lt 120; $w++) {
            $n = @(Get-ChildItem -Path $OutputDir -Include *.png,*.jpg,*.jpeg -File -Recurse).Count
            if ($n -eq $outCount) { $stable++ } else { $stable = 0; Log ("書き出し中: {0}/{1}" -f $n, $imgCount) }
            $outCount = $n
            if ($outCount -ge $imgCount) { break }
            if ($stable -ge 6) { break }
            Start-Sleep -Seconds 5
        }
        Log "完了: 入力 $imgCount 枚 → 出力 $outCount 枚"
        if ($outCount -lt $imgCount) {
            Write-Host "! 出力が入力より少ないです。検出できなかった画像がある可能性があります。"
        }
        exit 0
    }
}

throw "タイムアウト（$TimeoutMinutes 分）。処理が終わっていません。"
