# Meeting Copilot — Privacy Policy

_Last updated: 2026-07-31_

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

### Optional, advanced scopes (bring-your-own-credentials only)

If you configure the plugin with **your own** Google Cloud project (Advanced
settings), you may additionally grant read-only directory scopes so attendee names
and group invitees resolve for your Google Workspace domain:

- `https://www.googleapis.com/auth/directory.readonly` — resolve a Workspace
  attendee's **display name** from their email when Calendar didn't already provide
  it.
- `https://www.googleapis.com/auth/cloud-identity.groups.readonly` — expand a group
  invitee (e.g. `team@company.com`) into its member people.

These are **not** requested by the default, published app. They only return data for
users inside your own Google Workspace domain, and the plugin works without them
(it falls back to the name Calendar provides, or a readable version of the email
address).

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

## Compliance with Google API Services User Data Policy

Meeting Copilot's use and transfer of information received from Google APIs adheres
to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.
