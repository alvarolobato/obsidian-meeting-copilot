# Meeting Copilot

Granola-style meeting capture for Obsidian on macOS: Google Calendar → dual-channel recording → transcription (remote or on-device Whisper) → AI enrichment.

![Meetings Dashboard and agenda sidebar](docs/screenshot-dashboard.png)

## Installation

**BRAT (recommended):** install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then add:

```
alvarolobato/obsidian-meeting-copilot
```

**Manual:** download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/alvarolobato/obsidian-meeting-copilot/releases/latest) into `.obsidian/plugins/meeting-copilot/`, then enable the plugin.

On first recording, the `system-recorder` helper (and its `whisper` runtime) download automatically. Grant the macOS prompts, then quit and reopen Obsidian.

Optional: [Dataview](https://github.com/blacksmithgu/obsidian-dataview) (dashboard), [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) (action-item tracking).

See [Setup](docs/setup.md) for Google Calendar, AI endpoint, transcription, and enrichment.

## Features

- Dual-channel recording (system audio + mic)
- Google Calendar sync and agenda sidebar
- Auto notes, transcript, and AI enrichment
- Local on-device Whisper (optional)
- Meetings dashboard and recording retention

## More

- [Setup](docs/setup.md) — calendar, endpoint, transcription, enrichment, usage
- [Development](docs/development.md) — build, release, debugging
- [Organizing meeting notes](docs/organizing-meeting-notes.md)

## Requirements

- macOS 13.3+ (Apple Silicon)
- Obsidian Desktop
- Google account (calendar)
- OpenAI-compatible endpoint (local or remote) when you use enrichment and/or remote transcription. Not needed for on-device Whisper with enrichment off.

## Attribution

Meeting Copilot is an integrated meeting workflow built from permissively licensed open-source parts. It **vendors and adapts code** from the projects below — you do **not** need to install them separately. Full license texts are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

| Component | Source | Author | License | What we use |
|-----------|--------|--------|---------|-------------|
| Recorder & calendar | [System Recording](https://github.com/yut0takagi/obsidian-system-recording) | Yuto Takagi | 0BSD | Dual-channel ScreenCaptureKit recorder (`swift-helper/`), Google Calendar integration, and parts of the core plugin scaffolding |
| Agenda sidebar | [Meetings Plus](https://github.com/jabaho9523/obsidian-meetings-plus) | Jacob Holm | 0BSD | Meeting agenda view (day grouping, meeting rows, status header, date picker, and related UI/styles) |
| Remote transcription | [AI Transcriber](https://github.com/mssoftjp/obsidian-ai-transcriber) | Musashino Software | MIT | Transcription engine under `src/transcribe/vendor/` (audio chunking, VAD, Whisper/GPT-4o clients, cleaners, transcript merge, dictionary correction). Driven headlessly by Meeting Copilot — no AI Transcriber plugin required |

**Not from AI Transcriber:** on-device Whisper transcription runs in Meeting Copilot's own `system-recorder` Swift helper (whisper.cpp over Metal), not the vendored engine above.

## License

0BSD — see [`LICENSE`](LICENSE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
