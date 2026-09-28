# pixiv_booth_auto — Claude 向けメモ

AI生成CG集の制作〜販売を半自動化するプロジェクト。人間向けの使い方は README.md。
ここには **Claude が作業するときに踏みやすい罠と、崩してはいけない前提** を書く。

## 販売チャネル

| チャネル | 内容 | 状態 |
|---|---|---|
| pixiv | 作品から45枚を5枚×9投稿で小出しし、BOOTHへ誘導 | 稼働中 |
| BOOTH | 1作品130枚前後のPDFを500円で販売 | 稼働中 |
| Patreon | 英語圏向け。**専用ライン**（下記） | 審査待ち |
| FANZA | 500枚規模の作品。**別のスプレッドシート**（`pixiv_500` タブではない） | 未着手 |

## 絶対に崩さない前提

### 未成年を想起させる相手役の性的な画像は生成・加工・販売支援しない
`pixiv_100_MB` と `fanza_500` は相手役が `very young boy` / `gakuran` / `onee-shotacon` で、
性行為の行と組み合わさっている。これは未成年として描かれたキャラクターの性的な画像にあたるため、
**プラットフォームの審査や法律の扱いに関係なく、Claude は生成・モザイク・PDF化・ストーリーやセリフ作成・投稿の手伝いをしない。**
（2026-09-13 に方針を改めた。それ以前にこのリポジトリで②③作品の生成とストーリー作成を手伝ってしまっている）

- `sd-generate.js` は **タブに関係なく** `safety-lint.js` を全プロンプトにかけ、1件でも引っかかれば止める
- 続けられるのは、相手役を明確な成人男性に置き換えた版（`patreon_100` の方式）だけ
- 検査を外す・弱める変更は入れない

### 公開・投稿ボタンは人間が押す
`autoSubmit: false`。フォーム入力までが自動化の範囲。pixiv/BOOTHの規約上の判断でもある。

### 成人版のライン（patreon_100 方式）
Patreonは illustrated/AI生成の成人向け作品で「登場人物が間違いなく大人であること」を要求し、
未成年を想起させる相手役・文脈・場所を判断材料にする。CSAMはゼロトレランス。

- pixiv/BOOTH用の作品は相手役が `very young boy` / `onee-shotacon` なので **Patreonに流用不可**
- Patreon用は `--patreon` で `patreon_100` タブから生成したものだけ
- 学校系シーン（infirmary / classroom / library）は禁止
- `src/safety-lint.js` をタブ作成・生成前・素材作成前で通す。**例外を作らない**
- Claude自身が書いた英文も検査対象（過去に `kid` `younger` で止まった）

### ログインとCAPTCHAには触らない
パスワード入力・CAPTCHA突破はしない。`node src\login.js` / `node src\login.js booth` をユーザーに実行してもらう。

## 実行環境の罠

- ユーザーは **PowerShell 5.1**。`&&` 不可、`npm run` は実行ポリシーで弾かれる → `node src\x.js` を案内する
- Claude の Bash ツールはサンドボックス内。プロジェクト配下の書き込みは基本反映されるが、
  過去に `data/queue.json` の書き込みが実環境に反映されなかったことがある。
  **キューを作るコマンドはユーザー側で実行してもらう方が確実**
- ブラウザは `data/browser-profile` を共有する。**同時に2つ起動できない**。
  `pixiv-batch` 実行中に `booth-draft` を起動するとロックで落ちる

## ファイル編集の罠（何度も踏んだ）

**ヒアドキュメントで `\` が `\` に潰れる。** 正規表現・Windowsパス・`"\n"` が壊れる。

- 新規ファイルは `cat > file <<'END'` でよいが、`\` を含めない書き方にする
- 既存ファイルの修正は、スクラッチパッドに `.cjs` を書いて `node` で当てる。
  バックスラッシュが要る箇所は `String.fromCharCode(92)` で組み立てる
- 修正後は必ず `node --check` / `python -c "import ast; ..."` で構文確認
- `.ps1` は **UTF-8 BOM付き** で保存する（無いと日本語で構文エラー）

## pixiv の罠

- **予約投稿は同時10件まで。** `pixiv-batch.js` は実際の予約数を見て空き枠だけ処理する
- **予約時刻は30分刻み**のみ
- 投稿成功の判定（URL変化）は目安。**正は `sync-queue.js` による pixiv 予約一覧との突き合わせ**。
  `pixiv-batch.js` は終了時に自動で突き合わせる
- タイトルに連番（1/9）を付けない（最後まで追われて購買意欲が落ちる）。`titles-pixiv.js` で言い回しを変える
- **タイトルに作品名を入れない**（2026-09-25 ユーザー指定）。作品へ誘導している感じになるため。
  `config.pixiv.titleVariants` は「ふたりきりの時間」のような単体で成立する言い回しだけにする（`{{title}}` を使わない）

## BOOTH の罠

- カテゴリは「イラスト > イラスト集・CG集」（トップに「同人」は無い）
- カテゴリボタンは `type=submit`。**商品名が空だと開かない**。モーダルは「閉じる」で畳まないと後続を覆う
- モーダルは1回目のクリックで開かないことがある（`openModal` でリトライ）
- 商品画像は保存前でも即反映、**作品ファイル(PDF)は保存しないと消える**
- 「ダウンロード商品を登録」を押した時点で下書きができる。既存の下書きは `--item` で使い回す
- 規約: 商品画像は性器の露出NG。モザイクは長辺×1/100程度（1536pxなら約16px）
- 規約: 同一の制作技術で差別化されていない作品を出すショップは検索から除外される
  → 作品ごとに `--char` だけでなく `--scene` も変える

## データの置き場所

| パス | 中身 |
|---|---|
| `data/queue.json` | pixiv投稿キュー。`workTitle` で作品に紐付く |
| `data/works/<作品名>.json` | 登場人物・シーン・BOOTH URL |
| `data/choices.json` | タイトル・サムネ選択の学習データ |
| `data/word-prefs.json` | 言い回しの直しの学習 |
| `logs/patreon/<タイトル>/` | Patreon用の英語素材 |
| スプレッドシート「作品管理」タブ | `sync-sheet.js` で進捗を書き出す |

作品フォルダは `outputs/txt2img-images/<日付>_<番号>_<作品名>` と `...moza` のペアで持つ。
モザイク済みPNGはメタデータが消えるので、`describe.js` は同名のモザイク前ファイルからプロンプトを読む。
Patreon用は番号を `P01` のように `P` 付きにする。

## FANZA（2026-09-13 時点。新セッションはここから）

### シートは全タブ成人版に書き換え済み
2026-09-13、ユーザーの了承を得て `src/adultify-tabs.js` で全タブを書き換えた（元に戻すならスプレッドシートの版の履歴から）。
- 相手役: `very young boy` / `gakuran` → `1 adult man, 20s, short black hair, tall, broad shoulders`（学ランは business suit）
- 場所: 保健室 → 個人クリニック、教室 → オフィス／会議室、学校のプール → ホテルのプール、通学路 → 並木道
- 服装: セーラー服 → オフィスブラウス＋タイトスカート、female teacher → office lady
- `onee-shotacon` 削除、`N years old girl` → `woman`
- 全6タブ、書き込み後のQ列で safety-lint 不合格 0行
- `scenes.json` / `story.json` の学校系（infirmary / classroom / library）は削除し、clinic / meeting_room / city_library に置換

### fanza_500 タブ
- 379行・ちょうど500枚。生成は約4時間
- N列（場所）が複数あり、場所の移り変わりが話の流れ → **`--scene` は使えない。`--char` だけ**
- E列の基準文字列は pixiv_100 と違うが、`sd-generate.js` がタブの先頭データ行から自動で読む

```
node src\sd-generate.js --tab fanza_500 --char <キャラ>
```

### ユーザーの手作業（これを自動化する）
1. 生成（手作業では1行3〜4枚から選んでいた → 自動では500枚ぴったりでよい、とユーザー判断）
2. モザイク
3. 500枚の選定：非性的な導入シーン20〜40枚 ＋ 性的シーン → 500枚ぴったり生成なら選定不要
4. JPG化・連番リネーム
5. 導入シーンにセリフ（「30日後に結ばれる」設定で日ごとに仲が深まる。**2026-09-13: 女医と社会人（患者）の関係に決定**）→ `C:\Users\7700\claude\manga_bubble` の `add_bubbles.py`（bubbles.csv: filename, day, text1-3, pos1-3, color1-3）
6. 作品名（**売上に直結するのでユーザーが必ず確認する**）
7. 表紙・サムネ（以前は Canva）→ 自動化済み:
   - `node src\fanza-cover-hero.js` … 表紙用ヒロインを**青一色の背景**で生成し、切り抜けるまで自動で焼き直す
     （緑背景は黒髪に黄緑が映り込む。ネガに "green" を入れると背景の緑まで薄くなるので禁止）
   - `python tools\key-hero.py` … 色相で背景を抜く。背景より暗い画素（黒髪・紺）は残す
   - `python tools\make-fanza-cover.py` … 2色刷り背景＋ヒロイン＋タイトル。顔検出でタイトルと顔が被らない位置に置く
   - タイトル書式: `30日後[に]/{blue}S⚪︎Xする女医さん`（[ ]=ハートの助詞、{blue}=青字＋白フチの行）
   - 「⚪」はフォントに無いので「○」に自動置換。背景ページは非性的な導入シーンだけを使う
8. ZIP化
9. FANZAに投稿（説明文は以前 Gemini で生成）

### 仕上げ（生成500枚 → 納品フォルダ）
```
node src\fanza-build.js --title "30日後にS○Xする女医さん" --cover "30日後[に]/{blue}S⚪︎Xする女医さん" --date 2026-09-14
```
organize → mosaic → pages（001.jpg連番）→ bubbles（導入88枚にセリフ）→ covers（サムネ3枚）→ zip の順。
`--steps pages,bubbles` のように一部だけ実行できる。作品番号は既存の最大+1（今回は016）。

- セリフ: `config/fanza-dialogue.json`（23シーン×前半/後半、最後の1枚は締めのセリフ）。女医=ピンク、患者=ブルー
- 吹き出し: `src/fanza-bubbles.js` が作業フォルダを用意して `manga_bubble/add_bubbles.py` を呼ぶ（ユーザーの manga_bubble フォルダは汚さない）
- 吹き出しを付ける前の導入シーンは `_work/_intro_original/` に退避される
- 016「30日後にS○Xする女医さん」は **破棄済み**（2026-09-14）。全タブの C2 に版権キャラLoRA
  `lala_satalin_devilukePDXL`（作中で高校に通うキャラ）が入ったまま生成していたため。フォルダはゴミ箱へ
- 017 はキャラLoRAなしのオリジナルキャラ（28歳・ダークブラウン髪ローポニー・泣きぼくろ）で生成。
  番号が自動だと016になるので、仕上げは `--no 017` を付ける

### 番号の振り直し（2026-09-15）
ユーザーの呼び方に合わせ、**女医・ダークブラウン髪 = 016**、**エステ = 017**。

### 派生タブ（場所・シチュ・キャラ違い）
- `config/variants/<名前>.json` に置き換え表・キャラ（E列）・表紙の服装を書き、
  `node src\make-variant-tab.js --variant esthe` で `fanza_500` から派生タブを作る（検査に通らなければ書き込まない）
- セリフは作品ごとに `config/fanza-dialogue-<名前>.json`。C列のシーン名をキーにする（`sceneRename` で変えた名前に合わせる）
- 017 エステ: タブ `fanza_500_esthe`、黒髪ボブ・つり目・琥珀色の目。タイトル「30日後にS○Xするエステのお姉さん」（ユーザー決定）。巫女は次の候補
- 016 のタイトルは「30日後にS○Xする女医さん」を流用

### プロフィール画像・目次画像（2026-09-15 ユーザー指定）
- `fanza-build.js` の `extras` 工程（`src/fanza-extras.js`）で `00_表紙/NNNプロフィール.jpg` と `NNN目次.jpg`（1200×900）を作る
- 目次: A列の区切り＋R列の枚数から各パートの開始ページを出す。パート名と年齢・職業はタブごとに `config/fanza-toc.json`
  （新しい派生タブを作ったら、ここにも追加する）。写真は各パートからM列（行為）が空のコマを優先して1枚ずつ
- プロフィール: BOOTHと同じ `src/profile.js`。名前はセリフと同じ作品データ、`--age` `--job` で年齢・職業の行を出す
- 作品コメント: `src/fanza-description.js` → `00_表紙/NNN作品コメント.txt`（BOM付きUTF-8・CRLF）。
  作品構成（本編のページ数＋目次）/ キャラ（プロフィール）/ ストーリー / アピールポイント / 注意書き（AI使用・全員成人）。
  ストーリーとアピールは `config/fanza-toc.json` のタブ設定。extras 工程で目次・プロフィールの後に自動で作る
- 作品データの `fanza` は `saveWork` が1階層マージなので、書くときは既存の `fanza` を展開してから渡す

### Patreon英語版（2026-09-15 方針決定）
- ユーザー決定: 作品は「FANZA作品の英語版」と「patreon_100 の専用セット」の両方。FANZAは専売にしない。Tier は $0 / $5 / $12
  （$5 = 月2セット、$12 = 500ページ版＋リクエスト投票。単品は Shop）
- Patreon規約（2026-03改定）: 絵柄のAI成人向けは可。**登場人物が間違いなく成人**と解釈できること（体つき・タイトル・説明・学校系の場所や小物も判断材料）。
  エロ・ヌードは有料限定の投稿だけ。無料投稿・アイコン・バナー・Tier説明には出さない。添付は1ファイル5GBまで
- **モザイクは外さない**（日本在住者の配布は刑法175条の対象）
- `node src\patreon-fanza-en.js --title ... --tab ... --dialogue config/fanza-dialogue-en.json` →
  `<作品>/02_patreon_en/pages/`。導入88枚だけ英語の横書き吹き出し（`tools/en-bubbles.py`）。生成元の全プロンプトを lint してから作る
- 英語タイトルはシリーズ名「30 Days Until I Sleep With My ___」（Claudeが決定、ユーザー了承）。`config/fanza-toc.json` の titleEn / coverEn / sectionsEn / storyEn / appealEn
- `node src\patreon-fanza-assets.js --title ... --tab ...` → cover_en / profile_en / previews / PDF / ZIP / post_premium_en.txt / post_free_en.txt。
  公開面は導入ページのうち着衣・単体・透けなし・相手役なし・濡れ/オイル表現なしだけ（エステ版は場所に "oil bottles" があるので oil 単体では弾かない）。
  プロフィール写真は吹き出しの無い `_intro_original` から取る
- 英語名は作品データの `heroineEn`（名 姓の順）/ `heroEn` に手で入れる。`fanza-dialogue.js --lang en` は作品データを書き換えない

### Patreonの投稿（2026-09-15 に自動化、016で公開実績あり）
```
node src\login.js patreon                                    … 最初の1回だけ手動ログイン
node src\patreon-draft.js --work "<作品名>" --kind free       … 無料の見本投稿
node src\patreon-draft.js --work "<作品名>" --kind premium --tiers "Premium" --sell 12
```
- **掲載ボタンは押さない。** `--close` を付けると確認待ちせずブラウザを閉じる（下書きを続けて作るとき用）
- Patreonの罠:
  - **編集画面を開いた時点で空の下書きができる。** 途中で失敗したら `--post <編集URL>` で同じ下書きを使い回す
  - タイトルを入れるとURLがスラッグ付き（`/posts/30-days-until-i-169611585/edit`）に変わる。`waitForURL` は当てにならないので自前で待つ
  - 「画像」「添付ファイル」ボタンはドロップ枠を出すだけ。隠れた `input[type=file]`（画像は accept が画像だけのもの、添付は `accept="*"`）に直接渡す
  - ランクは「すべてのランクを選択」を外してから個別に選ぶ。ボタンの表示が「1ランク」等に変われば成功
  - 単品販売の価格は `input[name="product-price"]`。エディタは Enter 1回で段落が変わるので本文の空行は入れない
  - 大きい添付は、ファイル名が出てもアップロード中のことがある。掲載前にユーザーに確認してもらう
- Tier: Supporter $5 / Premium $12（ユーザーが作成済み）

### X（@ubicomics1）での集客（2026-09-16〜）
```
node src\x-queue.js --work "<作品名>" --weeks 2     … 週4本（見本2・セリフ1・紹介1）の予定を作る
node src\x-post.js                                  … 予定の確認（--dry が既定。投稿しない）
node src\x-post.js --post --limit 1                 … 予定時刻を過ぎたものを投稿
```
- 画像は `patreon.safePages`（着衣・単体・透けなし・相手役なし・濡れ表現なし）からだけ選ぶ。誘導先はPatreonの**無料投稿**
- 鍵は `config/x-credentials.json`（gitignore済み・ユーザーが自分で置く）。App は Read and write 権限
- **アカウント設定の「メディアをセンシティブとして設定」を必ずオンにする。** 投稿ごとのAPI項目が無いため、これが規約対応の本体
- X APIは2026年から従量課金（無料枠なし）。残高切れは 402。`x_ai_sidebiz` とは別アプリ・別残高で管理する
- **画像アップロードは `POST https://api.x.com/2/media/upload`（multipart）。** v1.1 の `upload.twitter.com` は2025年6月に廃止され、
  叩くと本文なしの403が返る。権限の問題と紛らわしいので注意（`/2/users/me` が通るなら鍵と残高は正常）
- OAuth 1.0a の署名は `src/x-auth.js`。multipart のときはボディを署名対象に含めない
- 投稿IDは19桁。数値として読むと丸まるので、生のJSONから文字列で取り出す
- 動作確認: `node src\x-check.js`（投稿しない）。`--now` を付けると予定時刻を待たずに1本出せる
- 2026-09-16 1本目を投稿: https://x.com/ubicomics1/status/2099905979605451000
- @ai01_kapichan（AI副業ペルソナ）と投資系アカには成人向けを混ぜない

### 30日目の最後のページ（全作品、2026-09-15 ユーザー指定）
- 後半ブロックで最後に出てくる「下着になる」系のコマ（ヒロインの下着姿）を導入の最後のページと画像ごと入れ替え、
  締めのセリフ＋白吹き出しのナレーション「このあと　めちゃくちゃ　S〇Xした」を付ける
- `fanza-dialogue.js` が `bubbles.swap.json` を書き、`fanza-build.js` の bubbles 工程が `_intro_original` から入れ替えた入力を作る
  （やり直しても吹き出しが二重にならない）。文言・位置はセリフ集の `afterword` で上書きできる
- 「〇」(U+3007) は吹き出しフォントにある。表紙フォントには無いので表紙では使わない
- 仕上げ: `--src F017_raw --tab fanza_500_esthe --dialogue config/fanza-dialogue-esthe.json --outfit "<variants の coverOutfit>"`

### 毎日の自動チェック（2026-09-21〜）
- Windowsタスク `ubicomics-daily-check` が毎日 **7:05 / 19:05** に `node src\daily-check.js` を実行
- 自動でやる: 生成済み（RAW_*）の仕上げ（モザイク含む）→ 英語版ページ・Patreon素材 → BOOTH用PDF → pixivキュー作成 → Xキュー補充
- 人間に回す: FANZA投稿、BOOTH/Patreonの公開ボタン、pixivの予約押し。**Discordへ通知**（`config/discord-webhook.json`、gitignore済み）
- 二重起動しない（`data/daily-check.lock`。6時間以上前のロックは無視）
- 作品の状態は `data/works/<作品名>.json` で判断する。`fanzaPosted` と `boothUrl` が埋まっていれば「投稿済み」とみなす
- **モザイクは画面操作なので、PCがロック画面だと失敗しうる**。失敗は通知に出る

### 作品の量産（2026-09-16）
- `tools/make-variant-config.mjs` の SPECS に職業ごとの値（服装・場所・行為・目次名・あらすじ）を1件足す →
  `node tools/make-variant-config.mjs <名前>` で `config/variants/<名前>.json` を生成 → `node src\make-variant-tab.js --variant <名前>`
  （タブ作成と同時に `config/fanza-toc.json` へ目次・英語情報も登録される）
- セリフは作品ごとに書かず、`config/fanza-dialogue-template.json`（英語は -en）＋ variant の `words` で差し替える。
  `fanza-dialogue.js --variant <名前>` で使う。016/017 だけは手書きのセリフ集（`--dialogue`）
- 仕上げも `node src\fanza-build.js --variant <名前> --src RAW_<名前>` の1行で済む（作品名・表紙・タブ・表紙の服装は variant から）
- `node src\run-batch.js --variants a,b,c` で複数作品の生成→まとめを連続実行。状態は `data/batch-state.json`、ログは `logs/batch.log`。
  **モザイク以降は含めない**（画面操作なのでPCがロックされていると失敗する）。帰宅後に `fanza-build` を回す
- safety-lint に引っかかる語に注意（`student` は禁止語。ヨガ版で踏んだ）

### 日付をまたぐ生成
A1111 は日付フォルダごとに 00000 から番号を振り直す。`node src\fanza-stage.js --dates 2026-09-14,2026-09-15 --out F016_raw`
で生成順のまま1フォルダにまとめ、`fanza-build.js --src F016_raw` に渡す。**まとめる前に次の生成を始めると混ざる。**
sd-generate のログ時刻はUTC。

### LoRA と髪色（2026-09-14 に入れた対策）
- **キャラLoRAは使わない。** `config.sd.allowedLoras`（今は画風LoRA `cnv3mdde878c738thn20` だけ）に無いLoRAが
  プロンプトにあれば、`sd-generate.js` と `fanza-cover-hero.js` は生成を止める。許可リストに足すのはユーザー確認後の画風LoRAだけ
- 年齢は全タブ `(28 years old woman:1.2)`。`(45 years old woman:1.5)` だと白髪・銀髪が混ざった
- `src/hair-guard.js` がキャラ文字列の髪色を読み、他の髪色（白・グレーは常に）をネガティブに足す。
  髪色はE列で `(dark brown hair:1.3)` のように重みを付けて書く。表紙ヒロインのプロンプトに髪色を直書きしない

### 納品の構成（既存作品 009 から確認）
```
NNN_作品名/
├─ 00_表紙/     サムネ 560×420（横長4:3）×3。003 は小 558×387 ＋ 大 1332×998 ×3
├─ 01_本編/     a (1).jpg 〜 a (500).jpg（1024×1536）
└─ 作品名.zip   01_本編/ を固めたもの
```
**BOOTHのサムネは縦長だが、FANZAは横長4:3。**
旧作（001〜015）のフォルダは旧設定の作品なので、画像は開かない・加工しない。構成の参照だけ。

### 規約（二次情報。公式は未確認）
- **AI生成作品は1オーナーあたり月3作品まで**（2025年11月〜）
- 登録時にAIの関与度を3段階から申告（必須）
- AI作品はトップ・ランキングから除外。審査は1週間〜1ヶ月
- **サンプル画像は本編から抜き出す**。パッケージ画像は本編外でも可
- パッケージとサンプルはモザイク強め推奨。実写主体は禁止
- 月3作品なので、投稿フォームの自動化より「表紙・サンプル・タイトル」の方が効果が大きい

### FANZAへの登録（2026-09-24 自動化。登録ボタンは押さない）
```
node src\login.js fanza A https://dojin.dmm.co.jp/addproduct   … アカウントごとに1回（「ログインしたままにする」を入れる）
node tools\dump-fanza-form.mjs A                                … フォームの項目を logs/fanza-addproduct.txt に書き出す（調査用）
node src\fanza-draft.js --variant yoga                          … 登録フォームを埋める。登録ボタンは押さない
```
- 作品フォルダ名（`NNN_B_作品名`）からアカウントを読み、`data/browser-profile-fanza-<A>` で開く
- 既定値は `config/fanza-post.json`。
  キャンペーン・クーポンは参加してすぐ自動参加、**専売は希望しない**（BOOTHでも売るため）、AI申告は「AIで作品を生成している」
- ファイル欄は隠れた `input[type=file]` に直接渡す。並びは 本体ZIP / パッケージ画像(560×420) / サムネイル(100×100) / サンプル画像(10枚) / サンプルムービー / 体験版
- サムネイル 100×100 は `00_表紙/NNNアイコン.jpg` として自動生成（パッケージ画像の中央を正方形に切る）
- 価格は**100円単位**。現在は税抜800円。発売記念の割引は**14日間80%OFFで固定**（ユーザー指定）
- サンプル画像10枚の並び（ユーザー指定）: 目次 → プロフィール → セリフ付きの導入ページを流れに沿って → 最後は導入のラスト（「このあとめちゃくちゃS〇Xした」）。1枚2MBまで
- 導入の枚数は作品データの `fanza.introImages`（60）
- **導入は60枚全部にセリフを入れる**（2026-09-24 ユーザー指定）。ストーリーボードの各ビートに
  `lines`（1枚目）と `lines2`（2枚目の続きの会話）を書く。`lines2` が無いビートは従来どおり「間」になる。
  30日目の2枚目は `lines2`（1行）＋ナレーションなので、`lines2` は1行にする（吹き出しは3つまで）
- ふりがな・キーワードは variant の `titleRuby` / `fanzaKeywords`。無い作品は `--ruby` `--keywords` で渡す
- **DMMのログインはセッションCookie（`login_session_id`）。** 永続プロファイルだけでは次の起動でログアウトする。
  `login.js` が開いている間はCookieを `data/cookies-fanza-<アカウント>.json` に退避し、
  `fanza-draft.js` などが起動時に `restoreCookies()` で注入する。**この仕組みを外すとログインが続かない**
- 2026-09-24 025（ヨガ・B）をFANZAに登録完了（初の自動入力→人間が登録ボタン）
- **ZIPのアップロードは時間がかかる。** 入力が終わってもブラウザは開いたままにするので、
  アップロード完了と内容を見てから自分で「登録する」を押す

### 生成の質（2026-09-26〜27 に入れた）
- **女どうしの絡みが混ざる問題**: `src/pair-guard.js`。Illustrious系は danbooru タグに強く反応するのに
  プロンプトに `1boy` が1つも無かったのが原因。生成直前に、相手役の男がいる行へ `1boy, 1girl, hetero` を、
  居ない行へ `1girl` を足す。ネガには全行 `yuri, 2girls, multiple girls, futanari…` を追加。**シートは触らない**
- **画風プリセット**: `src/style-preset.js`。既定は `shiron`（`config.sd.stylePreset`）。
  肌の照り（glossy/wet/sweat/specular）・寄りの構図・背景を落とす・表情を濃くする。`--style none` で外せる。
  構図タグは行ごとに close-up → cowboy shot → from above → dutch angle → face focus → from side を巡回。
  効きを見るのは `node tools\style-compare.mjs --tab <タブ> --rows 150,250 --account B`（同じ種で before/after）
- **導入のコマ割り**（2026-09-27 ユーザー指定・**導入だけ**）:
  ストーリーボードは `imagesPerBeat: 4`。ビルド工程に `panels` を追加し、
  導入120枚を2枚ずつ束ねて60ページ（2コマ）に合成する（`tools/make-panel-page.py`、レイアウト 1+2 / 2+1 / 2 / 3）。
  総ページ数は472のまま。セリフはページ1に `lines`、ページ2に `lines2`、30日目だけナレーションを足す。
  合成は**吹き出し前**の画像から行う（`bubbles` 工程より前に置く）
- 029〜032（ナース・裏喫茶・秘書・大家）は旧仕様（1ビート2枚・プリセットなし）のまま出す。新仕様は次ロットから

### 参考にしてよい作品の線引き（2026-09-27）
- 相手役が未成年として描かれた作品は、**コマ割りや構成の分析も含めて参考にしない**。
  pixiv 137551105（おねショタ・姉弟）と 149625272（坊ちゃま）は該当するため使わない
- 参考にしてよい例: pixiv 139041931 / 140279451（しろん・相手役は成人男性）。
  `node tools\peek-pixiv.mjs <作品ID>` でログイン済みプロファイルから開いて `logs/ref/<ID>/` に控える

### 生成が混ざったときの復旧（2026-09-26）
- `run-batch.js` は**二重起動を拒否**する（`data/run-batch.lock`）。過去に2本同時に走って日付フォルダで混ざった
- まとめ（`fanza-stage`）が枚数違いで落ちたら、`tools/recover-mixed.mjs --variant <名前> --date <日付>` が
  シートのQ列（プロンプト）とR列（枚数）から本来の並びを作り、同じプロンプトの画像を古い順に拾って `RAW_<名前>` に並べる。
  run-batch からも自動でフォールバックする。**アカウントB〜Dは画風タグが末尾に付くので、照合は前方一致**

### X用の白塗りサンプル（2026-09-27）
- `python tools\x-sample.py --raw <raw_FNNN_作品名> --moza <同名+moza> --out <出力先> --mode face --pages 20,50,300,430 --headline "…"`
- `--mode face` … 顔と吹き出しだけ残して他を白で塗り、残った範囲に寄せて切る（ユーザー指定の出し方）
- `--mode mosaic` … モザイク前後の差分から性的な箇所だけ白く塗る

### Patreonの配信ペース（2026-09-26 ユーザー指定）
- 無料は2日ごと（週3本）、有料は3日ごと。`daily-check.js` が別々に催促する
- 掲載日は作品データの `patreon.freePublishedAt` / `premiumPublishedAt` に分けて記録する
