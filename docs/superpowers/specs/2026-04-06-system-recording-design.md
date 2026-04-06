# Obsidian System Recording Plugin - Design Spec

## Overview

macOSのシステム音声（Zoom / Google Meet / Teams等）とマイク音声を同時に録音し、M4A(AAC)ファイルとしてVault内に保存するObsidianプラグイン。

## Target Platform

- macOS 13+ のみ
- Obsidian Desktop

## Architecture

```
┌─────────────────────────────────┐
│  Obsidian Plugin (TypeScript)   │
│  ・リボンボタン / コマンド       │
│  ・設定画面                      │
│  ・録音状態管理                  │
│  ・ノートへのリンク挿入          │
│                                 │
│   child_process.spawn()         │
│         │                       │
│         ▼                       │
│  ┌────────────────────────┐     │
│  │  Swift CLI ヘルパー     │     │
│  │  ・ScreenCaptureKit    │     │
│  │  ・システム音声キャプチャ│     │
│  │  ・マイク音声キャプチャ  │     │
│  │  ・ミックス → M4A保存   │     │
│  └────────────────────────┘     │
└─────────────────────────────────┘
```

- プラグイン本体: TypeScript（UI・制御）
- 録音処理: Swift CLI ヘルパー（ScreenCaptureKit + AVAudioEngine）
- 通信: child_process.spawn() + stdio（JSON）
- 外部ライブラリ依存: なし（Apple標準APIのみ）

## Swift CLI ヘルパー

### コマンドインターフェース

```bash
# 録音開始（stdoutにステータスをJSON出力、SIGINTで停止）
./system-recorder start --output /path/to/recording.m4a
```

### stdout出力（JSON Lines）

```json
{"status": "recording", "duration": 0}
{"status": "recording", "duration": 30}
{"status": "stopped", "duration": 185, "file": "/path/to/recording.m4a"}
```

### 録音処理

- ScreenCaptureKit: システム音声をキャプチャ（映像なし、音声のみ）
- AVAudioEngine: マイク音声をキャプチャ
- 両方をミックスしてAVAssetWriterでM4A(AAC)に書き出し
- SIGINT受信で録音を停止し、ファイルをfinalize
- SIGHUP受信（Obsidian終了時）でもファイルをfinalizeし、データを失わない

### 権限

- 初回実行時に macOS「画面収録」権限ダイアログが表示される
- 初回実行時に macOS「マイク」権限ダイアログが表示される

## Obsidian プラグイン

### UI

- **リボンアイコン:** マイクアイコン。クリックで録音開始/停止をトグル
- **録音中表示:** ステータスバー（Obsidian下部）に経過時間を表示（例: 録音中 00:05:30）
- **コマンドパレット:** 「録音開始」「録音停止」の2コマンド

### 設定画面

| 項目 | デフォルト値 | 説明 |
|------|-------------|------|
| 保存先フォルダ | `recordings/` | Vault内の録音ファイル保存先 |
| ファイル名テンプレート | `recording-YYYY-MM-DD-HHmm` | ファイル名の日時フォーマット |

### 録音フロー

1. ユーザーがリボンボタン or コマンドパレットで録音開始
2. プラグインが保存先フォルダの存在を確認（なければ作成）
3. Swift CLIを子プロセスとして起動（`--output` に保存パスを指定）
4. ステータスバーに経過時間をリアルタイム表示
5. ユーザーが停止操作
6. プラグインがSIGINTを送信
7. Swift CLIがファイルをfinalizeして終了
8. 現在のノートのカーソル位置に `![[recording-2026-04-06-1630.m4a]]` を自動挿入
9. 通知で「録音を保存しました」と表示

### エラーハンドリング

| エラー | 対応 |
|--------|------|
| Swift CLIが見つからない | 通知「ヘルパーが見つかりません」 |
| 権限が未許可 | 通知「システム環境設定から画面収録/マイクを許可してください」 |
| 録音中にObsidian終了 | Swift CLI側でSIGHUPを検知してファイルをfinalize |
| ディスク容量不足 | Swift CLIがエラーをstdoutに出力、プラグインが通知表示 |

## ファイル構成

```
obsidian-system-recording/
├── src/
│   ├── main.ts              # プラグインエントリポイント
│   ├── settings.ts          # 設定画面の定義
│   ├── recorder.ts          # Swift CLIの起動・制御
│   └── status-bar.ts        # ステータスバー表示
├── swift-helper/
│   ├── Package.swift         # Swift Package定義
│   └── Sources/
│       └── SystemRecorder/
│           ├── main.swift            # CLIエントリポイント
│           ├── AudioCaptureManager.swift  # ScreenCaptureKit + マイク制御
│           └── AudioMixer.swift      # ミックス + M4A書き出し
├── manifest.json             # Obsidianプラグインマニフェスト
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
└── README.md
```

## 出力ファイル形式

- 形式: M4A (AAC)
- サンプルレート: 44100Hz
- ビットレート: 128kbps
- チャンネル: ステレオ

## 配布

- ビルド時に `swift build -c release` でSwiftヘルパーをコンパイル
- リリース成果物: `main.js` + `manifest.json` + `styles.css` + `system-recorder`（バイナリ）
- Obsidianコミュニティプラグインとしての配布はバイナリ同梱の制約があるため、GitHub Releases での配布を想定
