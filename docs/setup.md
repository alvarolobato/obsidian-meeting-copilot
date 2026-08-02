# Setup

## Google Calendar

1. In the [Google Cloud Console](https://console.cloud.google.com/), create an OAuth 2.0 **Desktop** client and enable the Google Calendar API.
2. In *Settings → Meeting Copilot → Google Calendar integration*, paste the **Client ID** and **Client secret**, then click **Authenticate**.
3. Optionally set the **Target calendar ID** (defaults to `primary`) and the agenda's **horizon** / **history** window.

Client secret and OAuth tokens are stored in per-vault local storage on this device — not in synced `data.json`. Declined meetings are ignored. If the connection expires, the agenda shows **Reconnect**.

Auth also requests three **optional** scopes, each toggleable independently under *Settings → Meeting Copilot → Google Calendar integration → Advanced → Optional permissions* (all on by default). They only improve attendee display names on the agenda — calendar access itself never needs them:

- **Expand Google Group invitees** (`cloud-identity.groups.readonly`) — expands a Google Group on a calendar invite (e.g. `elg@…`) into the individual people on it, instead of showing the group's raw address.
- **Resolve attendee names from your Workspace directory** (`directory.readonly`) — looks up a real display name for attendees Calendar didn't already label. Some Workspace domains disable this for third-party apps entirely (a `people lookup blocked by Workspace admin policy` line in the console log, referencing [this Google setting](https://support.google.com/a/answer/6343701)) — that only blocks this scope, not the next one.
- **Resolve attendee names from Google "Other contacts"** (`contacts.other.readonly`) — a second, independent source for the same kind of data (people you've corresponded with over Gmail), unaffected by the admin setting above since it's your own private data, not the org directory. Syncs in the background at most once a day.

Turning a toggle off takes effect immediately (no more calls for that scope, cache hits from another source still apply). Turning one back on needs a **Re-authenticate** before Google actually grants it — existing tokens only carry whatever was requested at the time of the last consent. Expansion and name lookup run in the background after the agenda loads (so the calendar UI isn't blocked) and are capped by **Max group members to expand** in settings (default 50). Results are cached on disk in the plugin folder (`directory-cache.json`: people ~1 year, groups ~1 week; may sync with the vault if you sync `.obsidian/plugins`) and People API calls are throttled (~60/min) under Google's 90/min per-user quota. Re-authenticate clears negative (miss) cache entries so a first run before scopes/APIs were ready can recover. If a scope is off, disabled, or you can't view the group/person, labels fall back gracefully (group email / humanized local-part). Enable the **Cloud Identity API** and **People API** on your Google Cloud project if lookups fail with `SERVICE_DISABLED`.

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

Useful commands: *Clean up old recordings*, *Open meetings dashboard*, *Enrich meeting note (AI)*, *Toggle AI notes visibility*.
