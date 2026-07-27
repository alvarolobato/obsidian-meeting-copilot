# Setup

## Google Calendar

1. In the [Google Cloud Console](https://console.cloud.google.com/), create an OAuth 2.0 **Desktop** client and enable the Google Calendar API.
2. In *Settings → Meeting Copilot → Google Calendar integration*, paste the **Client ID** and **Client secret**, then click **Authenticate**.
3. Optionally set the **Target calendar ID** (defaults to `primary`) and agenda look-ahead / look-back.

Client secret and OAuth tokens are stored in per-vault local storage on this device — not in synced `data.json`. Declined meetings are ignored. If the connection expires, the agenda shows **Reconnect**.

## AI endpoint (shared)

In *Settings → Meeting Copilot → AI endpoint (shared)*, set the **API base URL** and **API key**. Used for enrichment and remote transcription — any OpenAI-compatible server, local (`http://localhost:…`) or remote. Leave blank if you only use on-device Whisper and skip enrichment.

Remote transcription needs `/audio/transcriptions`; enrichment needs `/chat/completions`. OpenAI and LiteLLM serve both. Ollama works for enrichment but has no transcription endpoint. Azure needs the `/openai/v1` OpenAI-compatible surface.

Optional **Fallback endpoint**: if the primary returns a service-level error (network, timeout, 5xx / 401 / 403 / 429), enrich and remote STT retry once on the fallback URL.

## Transcription

*Settings → Meeting Copilot → Transcription*:

- **Remote (API endpoint)** *(default)* — pick a model (`gpt-4o-transcribe` is most accurate; `whisper-1-ts` adds word timestamps), language, optional AI post-processing and custom dictionary.
- **Local (on-device Whisper)** — pick a local model (downloads once, SHA-256 verified). Audio never leaves your Mac.

Transcription runs headlessly when you transcribe a recording or when *Auto-transcribe when recording stops* is on.

### Local models

| Local model | Download | Peak RAM (approx.) | Notes |
| --- | --- | --- | --- |
| `small-q5_1` | ~190 MB | ~0.6 GB | Fastest / smallest |
| `medium-q5_0` | ~539 MB | ~1.6 GB | Middle ground |
| `large-v3-turbo-q5_0` *(default)* | ~574 MB | ~1.6 GB | Recommended on Max-tier chips |

- **Separate my voice from others** — labels you vs. others (two passes; ~2× time).
- **Fall back to remote on failure** — retry remotely if local fails (non-diarized). Off by default.

On Apple M5 Max, default model measured ~56× real time (~1 min for a 1-hour mixed track). Slower Macs: prefer `small` or `medium`.

## AI enrichment

Enable enrichment, load models (**Load models**), pick a chat model. Optionally enrich automatically after transcription.

## Usage

- Ribbon microphone: start/stop ad-hoc recording.
- Agenda sidebar: create note + record, transcribe, enrich, join.
- Meeting start/end prompts: in-app notice when Obsidian is frontmost; native macOS notification otherwise.
- Note context menu: same actions as the agenda.

### Notifications on macOS

macOS controls whether native notifications banner or land silently:

- Turn off Focus / DND (or allow Obsidian through).
- Set Obsidian to **Alerts** (*System Settings → Notifications → Obsidian*).
- While recording/mirroring, enable *Allow notifications when mirroring or sharing the display*.

For notification tracing, see [Development → Debugging notifications](development.md#debugging-notifications).

## Settings (overview)

- **Google Calendar** — client ID/secret, calendar, agenda windows, exclusion keywords.
- **Folders / templates** — recording folder, one-off / series / 1:1 / ad-hoc folders.
- **Recording retention** — days before trashing recordings (only after transcript is saved).
- **AI endpoint** — primary (+ optional fallback) URL and key.
- **Transcription** — engine, models, language, diarize, auto-transcribe.
- **AI enrichment** — enable, model, auto-enrich after transcription.
- **Action items as tasks** — lift Next steps / Follow-ups into checkboxes.

Useful commands: *Clean up old recordings*, *Create/update meetings dashboard*, *Enrich meeting note (AI)*, *Toggle AI notes visibility*.
