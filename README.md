# Obsidian System Recording

macOSのシステム音声（Zoom / Google Meet / Teams等）とマイク音声を録音し、WAVファイルとしてVault内に保存するObsidianプラグイン。

## Requirements

- macOS 13.0+
- Obsidian Desktop

## Features

- ScreenCaptureKitによるシステム音声キャプチャ（追加ドライバ不要）
- マイク音声との同時録音
- リボンボタン / コマンドパレットから操作
- 録音中はステータスバーに経過時間を表示
- 録音完了時に現在のノートへ自動リンク挿入

## Installation

### コミュニティプラグイン経由（推奨）

1. Obsidian の設定 → Community plugins → Browse → "System Recording" を検索してインストール
2. プラグインを有効化
3. 初回の録音開始時に、macOS ヘルパー（`system-recorder`）が GitHub リリースから自動ダウンロード・検証（SHA-256）され、プラグインフォルダに配置されます（Apple Silicon のみ）
4. 続いて「画面収録」と「マイク」の権限許可ダイアログが表示されます

### 手動インストール

1. Releases から最新版の `main.js`, `manifest.json`, `styles.css` をダウンロード
2. Vault の `.obsidian/plugins/system-recording/` に配置
3. Obsidian の設定 → Community plugins → System Recording を有効化
4. 初回録音時に `system-recorder` が自動ダウンロードされます（手動で配置することも可能）

## Usage

- 左サイドバーのマイクアイコンをクリックして録音開始/停止
- コマンドパレット (`Cmd+P`) → "Start recording" / "Stop recording"

## Settings

- **Recording folder**: 録音ファイルの保存先フォルダ（デフォルト: `recordings/`）
- **File name template**: ファイル名テンプレート（デフォルト: `recording-YYYY-MM-DD-HHmm`）

## Development

```bash
# Install dependencies
npm install

# Build Swift helper
cd swift-helper && swift build -c release && cd ..
cp swift-helper/.build/release/SystemRecorder system-recorder

# Build plugin (dev mode with watch)
npm run dev

# Build plugin (production)
npm run build
```

## Releasing

The macOS helper (`system-recorder`) is **not** distributed by Obsidian's community store
(only `main.js` / `manifest.json` / `styles.css` are). Instead the plugin downloads it on
first use from the GitHub release whose tag matches `manifest.json`'s `version`, and verifies
it against `EXPECTED_SHA256` in [`src/binary.ts`](src/binary.ts). **The embedded hash and the
released binary asset must come from the same build.**

1. `cd swift-helper && swift build -c release && cd ..`
2. `cp swift-helper/.build/release/SystemRecorder system-recorder`
3. `shasum -a 256 system-recorder` — copy the hex into `EXPECTED_SHA256` in `src/binary.ts`.
4. `npm run build` (bundles the updated hash into `main.js`), then `npm test && npm run lint`.
5. Bump `manifest.json` / `versions.json` / `package.json`, commit, and tag `X.Y.Z`
   (no `v` prefix — Obsidian matches the tag to `manifest.json`'s version).
6. `gh release create X.Y.Z main.js manifest.json styles.css system-recorder`
