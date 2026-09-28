# 別メンバーに引き継ぐときの手順

このプロジェクトは「コードを渡せば動く」タイプではない。
**ローカルの生成環境・外部ツール・各種の鍵**に依存しているので、そこを揃えるのが引き継ぎの本体。

読む順番: `CLAUDE.md`（前提とノウハウ）→ `STATUS.md`（いまの状態）→ この文書。

## 0. リポジトリは2つ（どちらもPrivate）

| リポジトリ | 中身 |
|---|---|
| `kenjoy4141/UbicomicsClaudePJ` | 本体（生成・仕上げ・投稿の自動化） |
| `kenjoy4141/manga_bubble` | 吹き出しツール（本体の `bubbles` 工程が呼ぶ） |

**同じフォルダの下に並べて clone する**と、設定なしで見つかる:

```
C:\Users\<名前>\claude\
  ├─ pixiv_booth_auto\   ← git clone https://github.com/kenjoy4141/UbicomicsClaudePJ.git pixiv_booth_auto
  └─ manga_bubble\       ← git clone https://github.com/kenjoy4141/manga_bubble.git
```

別の場所に置いたときは `config/config.json` の `mangaBubbleDir` を書き換える。
manga_bubble の `.env`（Anthropic APIキー）はリポジトリに入っていない。吹き出し工程では使わないので、なくても動く。

---

## 1. 渡すもの / 渡してはいけないもの

### リポジトリに入れて渡す
- `src/` `tools/` `config/*.json`（下の「渡さない」を除く）`package.json` `CLAUDE.md` `README.md` `STATUS.md`
- `config/variants/` `config/specs/` `config/intro-storyboard-*.json` … 作品の設計データ。これが資産

### 絶対に渡さない（`.gitignore` 済み。共有ドライブにも置かない）
| ファイル | 中身 | 渡し方 |
|---|---|---|
| `config/google-service-account.json` | スプレッドシートを読む鍵 | **相手用の鍵を新しく発行**し、シートをその鍵のメールアドレスに共有する |
| `config/x-credentials.json` | X APIの鍵 | 相手がXの投稿もやるなら、相手のアプリで発行し直す |
| `config/discord-webhook.json` | 通知先 | 相手のチャンネルのURLを入れてもらう |
| `data/cookies-fanza-*.json` | FANZAのログイン状態 | **渡さない。** 相手の環境で `node src\login.js` してもらう |
| `data/browser-profile*` | 同上 | 渡さない |

`config/accounts.json` にはFANZAのアカウントのメールアドレスが入っている。
渡すかどうかは運用の判断（下の「アカウントの扱い」を読むこと）。

---

## 2. 相手の環境に必要なもの

| 要るもの | 補足 |
|---|---|
| Windows + PowerShell 5.1 | スクリプトがWindows前提（パス・UIAutomation） |
| Node.js 20以降 | `npm install` で依存を入れる |
| Python 3.10以降 + Pillow + opencv-python | 表紙・コマ割り・切り抜き |
| Stable Diffusion WebUI（API有効） | `--api` 付きで起動。既定は `http://127.0.0.1:7860` |
| **チェックポイント** | `config/accounts.json` に書いてあるモデルを同じ名前で置く。無いと生成が止まる |
| 画風LoRA `cnv3mdde878c738thn20` | `config.sd.allowedLoras` の許可リストにあるもの |
| AutoMosaicTool_Pro | モザイク。既定は `C:\Users\7700\Downloads\AutoMosaicToolPro\...`。`tools/run-mosaic.ps1` の `-ToolDir` で変えられる |
| manga_bubble（吹き出しツール） | 別リポジトリ。上の「0.」のとおり本体と並べて clone する |
| フォント | `NotoSerifJP-VF.ttf` / `NotoSansJP-VF.ttf`（Windows標準で入っていることが多い） |
| Playwright のブラウザ | `npx playwright install chromium`。**Claude には実行させず本人がやる**（AppData配下はサンドボックス差分で失敗する） |

### 相手の環境で書き換える設定（`config/config.json`）
- `worksRoot` … SD WebUI の出力フォルダ。**ここが一番間違えやすい**
- `sd.baseUrl` … WebUI のURL
- `sheet.id` … 同じシートを使うならそのまま。別シートに分けるなら差し替え

---

## 3. 最初にやってもらう手順

```
npm install
npx playwright install chromium
node src\doctor.js                    … ブラウザが見つかるか確認
node tools\write-status.mjs           … STATUS.md が作れるか＝設定が読めるか確認
node src\login.js fanza A https://dojin.dmm.co.jp/addproduct
node src\probe-fanza.js A "https://dojin.dmm.co.jp/addproduct"   … 登録画面が出れば成功
```

そのあと、実際に1本流して確認する:

```
node src\run-batch.js --variants <名前>          … 生成（約5時間）
node tools\finish-pending.mjs --variants <名前>  … 仕上げ（モザイク中はPCをロックしない）
node src\fanza-draft.js --variant <名前>         … 登録フォームを埋める（登録ボタンは押さない）
```

---

## 4. FANZAアカウントの扱い（ここが一番の判断どころ）

- FANZAは **1アカウント（サークル）あたり AI作品は月3本**。だから複数アカウントで回している
- **アカウントの共有はDMMの規約上グレー。** 引き継ぐなら、相手には
  **相手名義のアカウントとサークルを新しく作ってもらう**のが安全
- そのうえで `config/accounts.json` に足す。必要なのは
  `email` / `slug` / `label` / `circle` / `model` / `stylePreset`
- 口座情報は各アカウントの持ち主が自分で登録する（売上の受取先が分かれる）

**共同で1つのサークルを運用したい場合**は、アカウントは渡さず
「生成・仕上げまでを相手がやり、登録ボタンは持ち主が押す」という分担にするとトラブルが少ない。
`fanza-draft.js` が登録直前で止まる作りなので、この分担に向いている。

---

## 5. 分担して同時に動かすときの注意

- **`data/queue.json` や `data/works/` を2人で同時に触らない。** 取り合いになる
- 生成は1台につき1本（`data/run-batch.lock` が二重起動を止める）。**別PCでは効かない**ので、
  誰がどの作品を回しているかは口頭かシートで決めておく
- スプレッドシートのタブ（`fanza_500_*`）は共有なので、同じ作品名で同時に作らない
- モザイクとブラウザ操作は画面を使う。片方が回している間、そのPCは触らない

---

## 6. 崩してはいけない前提（必ず読ませる）

`CLAUDE.md` の冒頭にある通り:

- **未成年を想起させる相手役の性的な画像は作らない・扱わない。** 参考作品の選定も同じ
- **公開・投稿ボタンは人間が押す**（`autoSubmit: false`）
- ログイン・CAPTCHAは自動化しない
- 許可リストにないLoRAは使わない（`config.sd.allowedLoras`）

この4つは引き継ぎ先でも変えないこと。
