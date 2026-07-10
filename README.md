# Meeting Copilot

A Granola-style meeting workflow for Obsidian on macOS. Meeting Copilot reads your Google Calendar, creates a note from the meeting invite, records **dual-channel** audio (system audio from Zoom / Google Meet / Teams **plus** your microphone) via ScreenCaptureKit, then transcribes and enriches the note with an AI summary and action items — no extra audio driver and no sidecar app.

## Requirements

- macOS 13.0+ (Apple Silicon)
- Obsidian Desktop
- A Google account (for calendar integration)
- An OpenAI-compatible LLM endpoint (OpenAI, Azure OpenAI, a LiteLLM proxy, Ollama, …) for transcription and enrichment

## Features

- **Dual-channel recording** — system audio via ScreenCaptureKit **plus** microphone, mixed into one file (no extra driver, no sidecar).
- **Google Calendar integration** — upcoming events, attendees, and Meet/Zoom link extraction, built in (no separate calendar plugin required).
- **Meeting agenda sidebar** — a "coming up / recent" list with per-row actions: create note + record, open note, transcribe, enrich, open recording, join link.
- **Automatic notes** — creates a meeting note from the invite, colocates the recording with it, and files recurring meetings into a per-series folder.
- **Transcript → note automation** — when a recording stops it can transcribe automatically and drop a collapsible transcript at the bottom of the note.
- **Granola-style AI enrichment** — generates a summary, key points, decisions, and action items into a gray, collapsible AI-notes callout you can toggle on/off; your manual notes stay untouched.
- **Action items → tasks** — enrichment lifts action items into `## Action items` checkboxes the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin can track.
- **Recording retention** — recordings older than a configurable number of days are moved to the trash automatically; the transcript stays in the note.
- **Meetings dashboard** — one command builds a [Dataview](https://github.com/blacksmithgu/obsidian-dataview) dashboard of upcoming/past meetings and open action items.
- **Status feedback** — ribbon button / command palette control, plus elapsed-time and action (recording / transcribing / enriching) indicators in the status bar.

## Required & optional plugins

Meeting Copilot handles calendar, recording, and enrichment on its own. Some features hand off to other community plugins:

| Plugin | Needed for | Required? |
| --- | --- | --- |
| [AI Transcriber](https://github.com/mssoftjp/obsidian-ai-transcriber) | Transcribing recordings (also drives auto-transcribe and enrich-on-transcribe) | **Required** for transcription |
| [Dataview](https://github.com/blacksmithgu/obsidian-dataview) | The Meetings dashboard command | Optional |
| [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) | Tracking the `## Action items` checkboxes | Optional (checkboxes work without it) |

> Transcription currently runs through AI Transcriber's engine. Install and enable it, and configure its API key / base URL (it also supports OpenAI-compatible / LiteLLM endpoints). AI enrichment uses Meeting Copilot's **own** endpoint settings and does not depend on any other plugin.

## Installation

1. Build or download `main.js`, `manifest.json`, and `styles.css`.
2. Copy them into `.obsidian/plugins/meeting-copilot/` in your vault.
3. In Obsidian, enable **Meeting Copilot** under *Settings → Community plugins*.
4. Install and enable the plugins you want from the table above (at least **AI Transcriber** if you want transcription).
5. On your first recording, the macOS helper (`system-recorder`) is downloaded and verified (SHA-256), then macOS prompts for **Screen Recording** and **Microphone** permissions — grant both. (You can also ship a prebuilt helper next to `main.js`; see [Development](#development).)

## Setup

### Google Calendar

1. In the [Google Cloud Console](https://console.cloud.google.com/), create an OAuth 2.0 **Desktop** client and enable the Google Calendar API.
2. In *Settings → Meeting Copilot → Google Calendar integration*, paste the **Client ID** and **Client secret**, then click **Authenticate** and complete the browser sign-in.
3. Optionally set the **Target calendar ID** (defaults to `primary`) and the agenda look-ahead / look-back windows.

### Transcription

Install **AI Transcriber**, enable it, and set its API key and base URL. Meeting Copilot calls it directly (no dialog) when you transcribe a recording or when *Auto-transcribe when recording stops* is on.

### AI enrichment

In *Settings → Meeting Copilot → AI enrichment*, enable enrichment, set the **API base URL** and **API key**, then click **Test connection** to load the available models and pick one from the dropdown.

## Usage

- Click the microphone icon in the left ribbon to start/stop an ad-hoc recording.
- Open the **meeting agenda** sidebar to create a note + record, transcribe, enrich, or join a meeting for any calendar event.
- When a calendar meeting starts, a notice offers **"Create note and start recording"**.
- Right-click a meeting note (or use the editor menu) to run the same actions — transcribe, enrich, open recording, join link.

## Settings

- **Google Calendar integration**: Client ID / secret, authentication, target calendar, agenda look-ahead / look-back, exclusion keywords.
- **Recording folder** / **File name template**: for ad-hoc recordings.
- **Meetings folder**: where calendar meeting notes (and their recordings) are created.
- **Recording retention (days)**: recordings older than this are trashed on startup and via *Clean up old recordings*; `0` keeps them forever. Recordings linked to a note that hasn't been transcribed/enriched yet are protected.
- **Auto-transcribe when recording stops**: transcribe automatically (no dialog) and add the transcript to the note.
- **AI enrichment**: enable it, set an OpenAI-compatible base URL, API key, and model (via **Test connection** + dropdown); optionally enrich automatically after transcription.
- **Action items as tasks**: lift enriched action items into `## Action items` checkboxes (preserving existing/completed tasks).

Commands of note: *Clean up old recordings*, *Create/update meetings dashboard*, *Enrich meeting note (AI)*, *Toggle AI notes visibility*.

## Development

```bash
npm install
cd swift-helper && swift build -c release && cd ..
cp swift-helper/.build/release/SystemRecorder system-recorder
npm run dev      # watch build
npm run build    # production build
npm test && npm run lint
```

### The macOS helper (`system-recorder`)

Obsidian's community store distributes only `main.js` / `manifest.json` / `styles.css`, not native binaries. The plugin downloads the `system-recorder` helper on first use from the GitHub release whose tag matches `manifest.json`'s `version`, and verifies it against `EXPECTED_SHA256` in [`src/binary.ts`](src/binary.ts). If you publish your own release, point `REPO` / `EXPECTED_SHA256` in `src/binary.ts` at it, or simply ship a prebuilt `system-recorder` next to `main.js`.

## Attribution

Meeting Copilot builds on generously-licensed open-source work:

- Base project and dual-channel ScreenCaptureKit recorder + Google Calendar integration: **[System Recording](https://github.com/yut0takagi/obsidian-system-recording)** by **Yuto Takagi** (0BSD).
- Meeting agenda sidebar: adapted from **[Meetings Plus](https://github.com/jabaho9523/obsidian-meetings-plus)** by **Jacob Holm** (0BSD).

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for full credits.

## License

0BSD — see [`LICENSE`](LICENSE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
