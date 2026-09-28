# 起動中の AutoMosaicTool_Pro のUI構造を吐き出す。
# ボタン名とAutomationIdが分かれば、そこを自動でクリックできる。
# 使い方: ツールを起動した状態で  powershell -ExecutionPolicy Bypass -File tools\inspect-window.ps1

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$procName = "AutoMosaicTool_Pro"
$proc = Get-Process -Name $procName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
    Write-Host "「$procName」が起動していません。ツールを起動してから実行してください。"
    exit 1
}

Write-Host "PID: $($proc.Id) / Window: $($proc.MainWindowTitle)"
Write-Host ("-" * 60)

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $proc.Id)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)

if (-not $win) {
    Write-Host "ウィンドウを取得できませんでした。"
    exit 1
}

function Show-Tree($element, $depth) {
    if ($depth -gt 6) { return }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($element)
    while ($child -ne $null) {
        $type = $child.Current.ControlType.ProgrammaticName -replace "ControlType.", ""
        $name = $child.Current.Name
        $id   = $child.Current.AutomationId
        $enabled = $child.Current.IsEnabled

        # 操作対象になりうるものだけ目立たせる
        $mark = ""
        if ($type -in @("Button", "CheckBox", "RadioButton", "Edit", "ComboBox", "List")) { $mark = " <<<" }

        $indent = " " * ($depth * 2)
        Write-Host "$indent[$type] name='$name' id='$id' enabled=$enabled$mark"

        Show-Tree $child ($depth + 1)
        $child = $walker.GetNextSibling($child)
    }
}

Show-Tree $win 0
