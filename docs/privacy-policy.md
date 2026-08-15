# Meeting Copilot — Privacy Policy

_Last updated: 2026-08-15_

Meeting Copilot is an open-source [Obsidian](https://obsidian.md) plugin for macOS
that helps you record, transcribe, and take notes on your meetings. It runs entirely
on your own computer inside Obsidian.

**There is no Meeting Copilot server.** The developer does not operate any backend,
does not receive your data, and cannot see your calendar, your notes, your
recordings, or your Google account. This policy explains exactly what data the
plugin touches and where it stays.

> This is the canonical source for the privacy policy. The public copy hosted for
> Google verification (`website/privacy.html`) mirrors this document — keep the two
> in sync.

## Who this policy covers

This policy applies to the Meeting Copilot Obsidian plugin ("the plugin", "we",
"our"). It is provided by the plugin's author, Alvaro Lobato.

## Google user data we access

If you connect Google Calendar, the plugin requests read-only access to the
following, using Google OAuth. You explicitly grant this on Google's consent screen,
and you can revoke it at any time (see **Revoking access** below).

| Scope | Why the plugin requests it | How the data is used |
| --- | --- | --- |
| `https://www.googleapis.com/auth/calendar.readonly` | Read your calendar events | Show your agenda in Obsidian, create meeting notes, and prompt you around each meeting's start/end. **Read-only** — the plugin never creates, edits, or deletes calendar events. |

### Optional contacts and groups access (only if you enable it in settings)

The plugin can optionally read contact and group information, purely to show real
attendee names on your agenda instead of a raw email address. Each of the scopes
below is requested **only** when you enable its toggle under _Settings → Google →
Advanced → Optional permissions_. Turn a toggle off and that scope is never requested
at sign-in; turn one back on and you must re-authenticate before Google grants it.
All three are read-only, and the plugin works fine without any of them — attendees
simply show a name derived from their email address.

| Scope | Setting that enables it | Why the plugin requests it | How the data is used |
| --- | --- | --- | --- |
| `https://www.googleapis.com/auth/cloud-identity.groups.readonly` | "Expand Google Group invitees" | Read the membership of a Google Group that appears as a calendar attendee | When an invite lists a group (e.g. `team@company.com`), show the individual people on it instead of the group's raw address. **Read-only** — the plugin never creates, edits, or deletes groups or memberships. |
| `https://www.googleapis.com/auth/directory.readonly` | "Resolve attendee names from your Workspace directory" | Read display names from your organization's Google Workspace directory | Look up a real display name for attendees your calendar invite doesn't already label. Only returns data for people inside your own Workspace domain, and some Workspace admins disable it for third-party apps entirely. |
| `https://www.googleapis.com/auth/contacts.other.readonly` | "Resolve attendee names from Google 'Other contacts'" | Read display names from your own "Other contacts" (auto-populated from your Gmail correspondence) | A second, independent source for attendee display names, useful when the directory lookup above is blocked by a Workspace admin. **Read-only** — the plugin never adds, edits, or deletes contacts. |

Resolved names may be kept in a local cache file (`directory-cache.json`) inside your
vault so the plugin doesn't re-query Google for every meeting. That cache never leaves
your device and you can delete it at any time. None of this data is sent anywhere
other than between your device and Google's own APIs.

## How your data is stored and used

- **Everything stays on your device.** Calendar data is read directly from Google's
  APIs into Obsidian on your Mac and written into your local Obsidian vault as
  Markdown notes that you control.
- **OAuth tokens** (the credentials that let the plugin read your calendar) are
  stored in Obsidian's per-vault local storage **on your device only**. They are not
  written to the synced `data.json` and are never transmitted to the developer.
- **No developer server.** The plugin communicates only with Google's official API
  endpoints (`accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`,
  and — for the optional scopes — `people.googleapis.com` and
  `cloudidentity.googleapis.com`). There is no intermediary server operated by us.
- **We do not sell, rent, or share** your Google user data with anyone. We do not use
  it for advertising, profiling, or training any AI/ML model.

## Optional features that send data to services you choose

Meeting Copilot also has recording, transcription, and AI-summary features that are
**independent of Google** and fully under your control:

- **Audio recordings** are captured and stored **locally** in your vault.
- **Transcription** can run **entirely on-device** (on-device Whisper — audio never
  leaves your Mac), or, if you choose, be sent to an **OpenAI-compatible endpoint
  that you configure with your own URL and API key**.
- **AI enrichment / summaries**, if you enable them, send the relevant note or
  transcript content to that same **user-configured** endpoint.

When you enable these optional features, data goes to the third-party endpoint **you**
chose, under **your** account and its privacy terms — not to the plugin's author.
Google Calendar data is not sent to these endpoints by the plugin except insofar as
it may appear in note content you choose to enrich. If you use only on-device
transcription and skip enrichment, nothing leaves your Mac.

## Data protection mechanisms

Because the plugin handles sensitive data — calendar events contain attendee email
addresses, meeting titles, descriptions, and scheduling details, and OAuth tokens
grant ongoing read access to your calendar — we apply the following protections:

- **Encrypted in transit.** All communication with Google APIs (`accounts.google.com`,
  `oauth2.googleapis.com`, `www.googleapis.com`) uses HTTPS/TLS. No data is ever
  sent over an unencrypted connection.
- **No developer-side storage — no at-rest encryption risk.** The developer retains
  absolutely no Google user data. There is no server, database, or cloud storage
  operated by the developer, so there is no developer-side at-rest data to secure or
  breach. All data at rest exists only on your device, in your Obsidian vault,
  protected by your operating system's file-system permissions. We strongly encourage
  enabling full-disk encryption (FileVault on macOS).
- **No developer server.** There is no Meeting Copilot backend that could be
  breached or subpoenaed. Data flows only between your device and Google's own
  endpoints.
- **Local-only storage.** All data written to disk lands in your Obsidian vault on
  your device — a location you own, control, and can encrypt with full-disk
  encryption.
- **OAuth tokens kept out of sync.** Tokens are stored in Obsidian's per-vault
  _local_ storage, explicitly excluded from vault sync (Obsidian Sync, iCloud,
  Dropbox, etc.). They never travel outside your device.
- **Google data held in memory until you act.** Calendar event data (titles,
  attendees, descriptions) is fetched into memory and only written to disk when you
  explicitly choose to create a meeting note. If you close Obsidian without creating
  a note, that data is discarded.
- **Contacts cache stored locally in your vault.** The optional local cache of
  resolved contact names (`directory-cache.json`) is written inside your vault
  folder. It never leaves your device and you can delete it at any time.
- **Minimum necessary access.** The default app requests only `calendar.readonly` —
  the narrowest scope sufficient for the feature. The optional contacts and group
  scopes are requested only when you turn them on in settings, and each can be turned
  off independently. The plugin never requests write access and cannot modify your
  calendar, contacts, or groups.
- **Open-source and auditable.** The full source code is published at
  [github.com/alvarolobato/obsidian-meeting-copilot](https://github.com/alvarolobato/obsidian-meeting-copilot).
  Anyone can inspect exactly how data is fetched, stored, and used.
- **No data sent to the developer.** The developer has no way to access your Google
  data, notes, recordings, or tokens. There is no telemetry, analytics pipeline, or
  crash-reporting mechanism that transmits user data to the developer.
- **User controls all AI/transcription endpoints.** If you enable transcription or
  AI enrichment, you supply your own API key and endpoint URL. Data goes to the
  service you chose, under your account — not to the developer.

## Data retention and deletion

- Meeting notes and recordings live in your Obsidian vault; you delete them like any
  other file. Recordings can be auto-pruned by the plugin's retention setting (only
  after a transcript is saved).
- Cached directory/group lookups (only present if you use the optional scopes) are
  stored in the plugin folder and expire automatically; deleting the plugin's
  `directory-cache.json` removes them immediately.
- Disconnecting or removing the plugin, and revoking access (below), stops all
  further data access.

## Revoking access

You can revoke the plugin's access to your Google account at any time at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).
You can also disconnect within the plugin's settings, which clears the stored
tokens from your device.

## Children's privacy

Meeting Copilot is a productivity tool not directed to children and does not
knowingly collect data from children.

## Changes to this policy

We may update this policy as the plugin evolves. Material changes will be reflected
here and in the hosted copy, with an updated "Last updated" date.

## Contact

Questions about this policy or the plugin's data handling:

- Email: alvarolobato@gmail.com
- Issues: https://github.com/alvarolobato/obsidian-meeting-copilot/issues

## Security incidents

Because the developer retains no Google user data, the realistic security incident is
compromise of the OAuth client credentials (client ID / client secret). In the event
of any such incident, we will promptly notify
[security@google.com](mailto:security@google.com) and publish details in the plugin's
[GitHub issue tracker](https://github.com/alvarolobato/obsidian-meeting-copilot/issues).
Users should revoke the plugin's access at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) until a
patched version is available.

## Compliance with Google API Services User Data Policy

Meeting Copilot's use and transfer of information received from Google APIs adheres
to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

The use of raw or derived user data received from Google Workspace APIs — including
any data aggregated, anonymized, or derived from those scopes — will not be used to
develop, improve, or train generalized AI or ML models. This applies to all data
obtained via `calendar.readonly`, `directory.readonly`,
`cloud-identity.groups.readonly`, and `contacts.other.readonly`.
