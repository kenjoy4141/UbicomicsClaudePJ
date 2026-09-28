# pixiv_booth_auto

SD生成 → モザイク → BOOTH販売 → pixiv集客 のパイプライン半自動化。
**公開・投稿ボタンは人間が押す**設計（`autoSubmit: false`）。

## 1サイクルの流れ

3日に1回、CG集(130枚)をBOOTHに出し、その一部をpixivに小出しして誘導する。

```
① 生成      node src\sd-generate.js --char <キャラ> --scene <シーン>     70分・放置
② モザイク  powershell ... run-mosaic.ps1 -InputDir <raw> -OutputDir <rawmoza> -Force   6秒
③ 候補出し  node src\candidates.js "<mozaフォルダ>"
            node src\choose.js --title <番号> --image <番号>
④ 素材作成  node src\story.js --title "<作品名>" --scene <シーン> --out logs\story.txt
            node src\profile.js --work "<作品名>" --dir "<mozaフォルダ>" --out logs\profile.jpg
            python tools\make-thumbnail.py --image "<選んだ画像>" --title "<作品名>" --out logs\thumbnail.jpg
            python tools\make-booth-pdf.py --input "<mozaフォルダ>" --title "<作品名>"
⑤ BOOTH     node src\booth-draft.js --title "<作品名>" --pdf "..." --thumb "..." --profile "..." --pages 130 --story-file logs\story.txt
            → 「公開で保存する」は手動
⑥ pixiv     node src\build-queue.js --dir "<mozaフォルダ>" --posts 9 --random --title "<作品名>" --booth "<URL>"
            node src\reslot.js
            node src\pixiv-batch.js
            → 「投稿する」は手動
```

PowerShell では `npm run` が実行ポリシーで弾かれるため、`node` で直接叩く。

## 自動化の状況

| 工程 | 状態 |
|---|---|
| プロンプト生成（シートのキャラ・場所差し替え） | 自動 |
| 画像生成 130枚 | 自動（70分） |
| モザイク | 自動（6秒。GUIをUIAutomationで操作） |
| タイトル候補・サムネ候補 | 自動（選択は人間。選択結果を学習） |
| サムネ画像 / プロフィールカード / PDF | 自動 |
| ストーリー文 | 自動（ラブコメ） |
| BOOTH商品ページ入力 | 自動（**公開ボタンは手動**） |
| pixiv投稿フォーム入力 | 自動（**投稿ボタンは手動**） |
| 予約枠の割り当て | 自動 |

## スクリプト

### 生成・加工

| コマンド | 用途 |
|---|---|
| `sd-generate.js --char X --scene Y` | シートのQ列を読み、キャラと場所を差し替えて一括生成 |
| `sd-generate.js --list` | キャラ12種・シーン8種の一覧 |
| `tools\run-mosaic.ps1` | AutoMosaicTool_Pro を操作してモザイク |
| `tools\make-booth-pdf.py` | 連番リネーム → JPG化 → 1つのPDF |
| `tools\make-thumbnail.py` | 白枠＋縦書きタイトルのサムネ |
| `tools\make-profile.py` | ヒロインのプロフィールカード |

### 選択・生成物

| コマンド | 用途 |
|---|---|
| `candidates.js <フォルダ>` | タイトル候補6件＋サムネ候補6件（プレビュー付き） |
| `choose.js --title N --image N` | 選択を記録。傾向を学習して次回の並び順に反映 |
| `choose.js --title N --title-text "手直し"` | 言い回しの直しも学習（例 ワンルーム→お部屋） |
| `choose.js --stats` | これまでの傾向 |
| `story.js --title X --scene Y` | ラブコメのストーリー生成。登場人物を作品データに保存 |
| `profile.js --work X --dir Y` | プロフィールカード。`--work` で名前を共有 |

### 投稿

| コマンド | 用途 |
|---|---|
| `login.js` / `login.js booth` | 手動ログイン（認証情報はブラウザプロファイルにのみ残る） |
| `booth-draft.js` | BOOTH商品ページを埋める |
| `build-queue.js` | pixiv投稿キューを作る |
| `reslot.js` | 予約枠を割り当て直す（`--order interleave` で作品を交互に） |
| `pixiv-batch.js` | タブを並べて一括入力。押されたタブを自動検知 |
| `sync-queue.js` | **pixiv側を正としてキューを直す**（取りこぼしの検出） |
| `list-reserved.js` | pixivの予約投稿一覧 |

### シート

| コマンド | 用途 |
|---|---|
| `sheets.js --check` | API接続の確認 |
| `add-portrait-rows.js` | 単体・着衣のポートレート行をシートに追加 |

### 調査用（UIが変わって壊れたとき）

`probe-upload.js` `probe-reserve.js` `probe-booth*.js` `doctor.js` `tools\inspect-window.ps1`

## 主な設定 (config/config.json)

| キー | 意味 |
|---|---|
| `autoSubmit` | true で投稿ボタンまで自動。既定 false |
| `pixiv.imagesPerPost` | 1投稿あたりの画像枚数（5） |
| `pixiv.maxReservations` | pixivの予約投稿の上限（10）。超える分は自動で次回に回る |
| `pixiv.defaultTags` | 全投稿に付く固定タグ |
| `schedule.weekday/weekend` | 予約枠の時刻。**pixivは30分刻みのみ** |
| `booth.price` / `category` / `tags` | BOOTH商品の既定値 |
| `sd.negativeExtra` | 首や体の複製を抑えるネガティブ追記 |

その他: `characters.json`(キャラ) `scenes.json`(場所・役柄) `story.json`(ストーリー雛形)
`names.json`(名前・趣味・好物) `describe-map.json`(プロンプト→日本語) `selectors.json`(pixivのDOM)

## 学習される情報

- `data/choices.json` — 選んだタイトルの型・サムネの特徴
- `data/word-prefs.json` — 言い回しの直し
- `data/works/<作品名>.json` — 登場人物・プロフィール・BOOTH URL

`candidates.js` は5作品ぶん溜まると学習の影響度が100%になる。

## つまずきやすい点

- **pixivの予約投稿は同時10件まで。** 超える分は公開されて枠が空いてから追加する
- **pixivの予約時刻は30分刻み**（12:15 などは選べない）
- **BOOTHのカテゴリは「イラスト > イラスト集・CG集」。** トップに「同人」は無い
- BOOTHのカテゴリボタンは `type=submit` なので、**商品名が空だと開かない**
- BOOTHのモーダルは**1回目のクリックで開かないことがある**（リトライ実装済み）
- **BOOTHの商品画像は保存前でも即反映されるが、作品ファイル(PDF)は保存しないと消える**
- モザイク済みPNGはメタデータが失われるため、`describe.js` は**同名のモザイク前ファイル**を探す。
  作品フォルダは `<作品名>` と `<作品名>moza` のペアで持つこと

## 注意

- pixiv / BOOTH とも利用規約は自動化を制限している。本ツールは入力までに留め、
  公開・投稿の実行は人間が行う前提
- `data/browser-profile/` にログインセッション、`config/google-service-account.json` に
  シートの鍵が入る。どちらも共有しないこと（.gitignore 済み）
- BOOTHのモザイク基準は「最小4px平方、または画像長辺×1/100程度」。
  1024x1536 なら約15.4px 必要（`appsettings.txt` の `BlockSize` を16に設定済み）
- BOOTHは「同一の制作技術で差別化されていない作品を出すショップ」を検索から除外する方針。
  作品ごとにキャラだけでなく**場所・役柄も変える**こと（`--scene`）
