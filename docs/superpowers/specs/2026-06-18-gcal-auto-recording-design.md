# Google カレンダー連携による自動録音 — 設計

- **日付**: 2026-06-18
- **対象プラグイン**: System Recording (Obsidian, macOS 専用)
- **ブランチ**: `feat/gcal-auto-recording`

## 目的

Google カレンダーと連携し、予定の開始時刻になったら通知を出して録音を開始できるようにする。会議系の予定で「録音し忘れ」を防ぎ、Meet 会議には自動で参加できるようにする。

## 確定した要件

| 項目 | 決定 |
|---|---|
| 連携方法 | Google Calendar API（OAuth 2.0、BYO クライアント認証情報） |
| OAuth 実装 | 既存プロジェクト `obsidian-notion-dashboard` の `GoogleOAuth`（loopback + PKCE）を移植。スコープは `calendar.readonly` のみ |
| 対象予定 | 除外キーワードを含む予定**以外**すべて（終日予定は対象外） |
| 開始時の挙動 | 開始時刻に通知を表示し、ユーザーが**「録音開始」ボタンをクリックして手動開始** |
| Meet の挙動 | 予定に Meet リンクがあれば、開始時刻に**自動でブラウザで開く**（録音の判断とは独立） |
| 終了時の挙動 | 終了時刻に通知を表示。**停止は手動**（「録音停止」ボタン） |
| 検知方式 | **ポーリング + 定期ティック**（スリープ復帰・再読込に強い） |

## 非目標（v1 のスコープ外）

- 複数カレンダーの統合監視（v1 は単一カレンダー、既定 primary）
- タイトル以外（説明・場所）でのキーワード判定
- 録音の自動停止（v1 は手動停止のみ）
- 開始時の完全自動録音（v1 は通知からの手動開始）
- モバイル対応（既存どおり `isDesktopOnly`）

## アーキテクチャ

既存の「小さく責務が明確なモジュール」方針に合わせる。

```
src/
  auth/
    googleOAuth.ts        OAuth クラス（移植）。BYO client_id/secret を plugin data に保存。
                          loopback + PKCE フロー、トークン保存・更新。スコープ = calendar.readonly
  calendar/
    googleCalendar.ts     listEvents / listCalendars（Calendar API v3）。Meet リンク抽出を追加
    meetLink.ts           extractMeetLink(rawEvent) — 純関数（テスト対象）
    eventFilter.ts        shouldRecord(event, exclusionKeywords) — 純関数（テスト対象）
    scheduler.ts          CalendarScheduler — ポーリング + ティックの中核（テスト対象）
  ui/
    actionNotice.ts       ボタン付き Notice を生成するヘルパー
  main.ts                 配線。scheduler コールバック → Meet オープン / 通知 / 既存 startRecording・stopRecording
  settings.ts             設定項目の追加
```

### 各モジュールの責務

- **googleOAuth.ts**: 認証情報・トークンの永続化、`getAccessToken()`（必要時リフレッシュ）、`authenticate()`（loopback PKCE フロー）。`obsidian-notion-dashboard/src/auth/googleOAuth.ts` を移植し、`SCOPES` を `["https://www.googleapis.com/auth/calendar.readonly"]` に絞る。
- **googleCalendar.ts**: アクセストークンで Calendar API を叩く。`listEvents(oauth, calendarId, timeMin, timeMax)` は raw event を `GCalEvent`（id, summary, start, end, allDay, meetLink, htmlLink）にマップ。`listCalendars(oauth)` は設定のカレンダー選択用。
- **meetLink.ts**: `extractMeetLink(rawEvent): string | null`。優先順位 = `hangoutLink` → `conferenceData.entryPoints[]` のうち `entryPointType === "video"` の `uri` → なし。
- **eventFilter.ts**: `shouldRecord(event, exclusionKeywords): boolean`。終日予定は `false`。タイトルにいずれかのキーワードを含めば（大文字小文字無視の部分一致）`false`。キーワード空なら全て `true`。
- **scheduler.ts**: 後述のポーリング + ティックを担う。時計・OAuth・コールバックを注入してテスト可能にする。
- **actionNotice.ts**: `timeout 0` の Notice を `DocumentFragment` で生成し、ボタンの click ハンドラを受け取る。
- **main.ts**: scheduler の `onEventStart` / `onEventEnd` を録音制御・Meet オープン・通知に接続。コマンド追加。
- **settings.ts**: OAuth 認証情報、認証ボタン、自動録音トグル、対象カレンダー、除外キーワード、Meet 自動オープントグル。

## データフロー

1. **起動**: 設定・トークンを読み込む。認証済み かつ 自動録音ON なら `scheduler.start()`。
2. **ポーリング（既定 5 分毎 + 起動直後）**: `listEvents` で直近の予定（窓 = now 〜 now+数時間）を取得 → `shouldRecord` で除外フィルタ → 結果をキャッシュ（id, summary, start, end, meetLink）。
3. **ティック（既定 20〜30 秒毎）**: キャッシュ各予定を現在時刻と照合。状態 `Map<eventId, {started: boolean, ended: boolean}>` で重複発火を防止。
   - **開始検知**（`now >= start` かつ start 未発火 かつ `now - start < grace`）: `onEventStart(event)` を発火 → start を記録。
   - **終了検知**（`now >= end` かつ end 未発火 かつ `now - end < grace`）: `onEventEnd(event)` を発火 → end を記録。
   - `grace` は約 2 分。これを過ぎた古い境界は発火しない（スリープ復帰や再読込で過去の予定が一斉発火するのを防ぐ）。
4. **状態管理**: 状態 Map は古い予定をプルーニング。プラグイン再読込で Map はリセットされるが、`grace` 窓により陳腐な再発火は抑制される。
5. **停止**: `scheduler.stop()` でポーリング/ティックのタイマーを解除（`onunload` と自動録音OFF時）。

## main.ts の配線

- **onEventStart(event)**:
  1. `meetLink` があり、かつ「Meet を自動で開く」がONなら `window.open(meetLink, "_blank")`。
  2. 開始通知（`actionNotice`）: 「『{summary}』が始まりました」＋「録音開始」ボタン。click → 既存 `startRecording()` を呼び、通知を閉じる。
- **onEventEnd(event)**:
  - 終了通知: 「『{summary}』が終了しました」＋「録音停止」ボタン。click → 既存 `stopRecording()` を呼び、通知を閉じる。

## 通知（actionNotice）

- Obsidian `Notice` に `DocumentFragment` を渡し、メッセージ要素とボタンを構築。`timeout 0` で自動消滅させない。
- ボタン click でアクション実行後、`notice.hide()` で閉じる。

## 設定項目

| 設定 | 種別 | 既定 |
|---|---|---|
| OAuth Client ID | テキスト | （空） |
| OAuth Client Secret | テキスト | （空） |
| Google カレンダーを認証 | ボタン（loopback フロー）＋状態表示 | — |
| カレンダー自動録音 | トグル | OFF |
| 対象カレンダー | ドロップダウン（`listCalendars`） | primary |
| 除外キーワード | 複数行テキスト（行 or カンマ区切り） | （空） |
| Meet を自動で開く | トグル | ON |
| 録音フォルダ（既存） | テキスト | recordings |
| ファイル名テンプレート（既存） | テキスト | recording-YYYY-MM-DD-HHmmss |

ポーリング間隔（5分）・ティック間隔（20〜30秒）・grace（2分）は v1 では定数（設定に出さない）。

## コマンド

- 「Google カレンダーを認証」 — loopback フローを起動
- 「カレンダー自動録音を切り替え」 — scheduler の start/stop
- （既存）「録音開始」 / 「録音停止」

## エラー処理

- 未認証で自動録音を有効化 → 認証を促す通知。
- トークンリフレッシュ失敗 → 通知してポーリング継続（次回ポーリングで再試行）。
- API エラー → 通知（短時間の連続エラーは抑制）してポーリング継続。
- 開始通知クリック時に既に録音中 → 既存の "Already recording" 通知。
- Meet オープン失敗 → 通知して継続。
- 非 macOS / 非デスクトップ → 既存どおり録音不可。OAuth はデスクトップのみ。

## エッジケース

- **終日予定**: `shouldRecord` で常に対象外。
- **重複/連続する予定**: 各予定は独立して発火。録音は単一インスタンスのため、録音中に別予定が開始しても「録音開始」クリックは no-op（既存ガード）。
- **再読込が予定の最中**: 次回ポーリングで再取得。状態 Map はリセットされるが grace 窓により、開始から 2 分以上経過した予定の開始通知は再発火しない。
- **タイムゾーン**: Calendar API の `dateTime`（タイムゾーン込み）を `Date` にパースし、ローカル壁時計と比較。

## テスト（既存 vitest）

- **eventFilter.shouldRecord**: 終日予定は除外 / キーワード一致（大小無視）で除外 / キーワード空なら全録音 / 部分一致。
- **meetLink.extractMeetLink**: hangoutLink あり / conferenceData の video エントリ / どちらもなし。
- **scheduler**: 注入した時計と疑似予定リストでティックを手動駆動し、「開始1回のみ発火」「終了1回のみ発火」「grace 超過は未発火」「同一予定の重複防止」を検証。
- OAuth / Calendar API の I/O は単体テスト対象外（手動検証）。既存 `BinaryProvisioner` と同様に依存注入で純ロジックを切り出す。

## 移植元の参照

- `obsidian-notion-dashboard/src/auth/googleOAuth.ts` — OAuth クラス（loopback + PKCE、トークン保存・更新）
- `obsidian-notion-dashboard/src/adapters/googleCalendar.ts` — `listEvents` / `listCalendars`（Meet 抽出を追加）
