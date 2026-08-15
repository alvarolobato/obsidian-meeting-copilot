# Google OAuth Verification — Submission Pack

Working notes and copy for taking the Meeting Copilot Google Cloud project through
OAuth **app verification** (Sensitive scopes) and publishing to **Production**.
Tracks issue #143.

This file is the source of truth for the text we paste into the Google Cloud
**Verification Center** (scope justifications, data-handling summary) and the
**demo-video shot list**. Keep it in sync with the actual consent screen and the
[privacy policy](./privacy-policy.md).

---

## 1. Scope strategy

**Published app: `calendar.readonly` always, plus three user-togglable attendee-name
scopes.**

All requested scopes are **Sensitive** (not Restricted), so this is standard
verification — **no** paid third-party CASA security assessment.

| Scope | Classification | In published app? | Notes |
| --- | --- | --- | --- |
| `.../auth/calendar.readonly` | Sensitive | ✅ Always | Core: read agenda, create notes, meeting prompts. |
| `.../auth/cloud-identity.groups.readonly` | Sensitive | ✅ Opt-in toggle | Expand group invitees into members. |
| `.../auth/directory.readonly` | Sensitive | ✅ Opt-in toggle | Resolve Workspace attendee display names. |
| `.../auth/contacts.other.readonly` | Sensitive | ✅ Opt-in toggle | Resolve attendee display names from the user's own "Other contacts". |

> ⚠️ Before submitting, open the consent screen and confirm each scope's label really
> is **Sensitive**. If Google has reclassified any to **Restricted**, that pulls in a
> paid annual CASA assessment — stop and reassess.

The three attendee-name scopes are requested only when the matching toggle under
**Settings → Google → Advanced → Optional permissions** is on
(`getOptionalScopes()` in `src/main.ts`); `calendar.readonly` is always requested.
Every scope is read-only and only feeds attendee-name display on the agenda.

> **Decision (2026-08-15):** supersedes the 2026-07-31 calendar-only decision. The
> optional attendee-name scopes are now part of the published app and are included in
> this verification submission, rather than being reachable only with
> bring-your-own-credentials. Each stays individually togglable in Advanced settings,
> so a user who declines them still gets a calendar-only consent screen.

---

## 2. Scope justifications (paste into Verification Center)

### `https://www.googleapis.com/auth/calendar.readonly`

> Meeting Copilot is an Obsidian plugin that helps users record and take notes on
> their meetings. It needs read-only access to the user's Google Calendar to display
> the user's upcoming agenda inside Obsidian, to automatically create a local meeting
> note for each event (title, time, attendees), and to prompt the user to start/stop
> recording around each meeting's start and end time. The plugin never creates,
> modifies, or deletes calendar data — read-only is sufficient and is the narrowest
> scope that provides event details and attendee lists. All data is processed locally
> on the user's device and stored in their own Obsidian vault; there is no backend
> server.

**Why not a narrower scope:** `calendar.readonly` is already the narrowest Calendar
scope that returns event details and attendees. `calendar.events.readonly` would omit
calendar-list metadata the agenda uses; there is no read-only scope narrower than
event read that still lists attendees.

### (Opt-in) `https://www.googleapis.com/auth/cloud-identity.groups.readonly`

> Requested only when the user turns on "Expand Google Group invitees" in the plugin's
> Advanced settings. Used to expand a group invited to a meeting (e.g.
> `team@company.com`) into its individual members so the meeting note lists the actual
> attendees instead of the group's raw address. Read-only, processed locally on the
> user's device; the plugin never creates, edits, or deletes groups or memberships.

### (Opt-in) `https://www.googleapis.com/auth/directory.readonly`

> Requested only when the user turns on "Resolve attendee names from your Workspace
> directory" in the plugin's Advanced settings. Used to resolve a Google Workspace
> attendee's display name from their email address when Google Calendar did not
> include the name, so meeting notes show real names instead of email addresses.
> Read-only, used only for name display, processed locally on the user's device.

### (Opt-in) `https://www.googleapis.com/auth/contacts.other.readonly`

> Requested only when the user turns on "Resolve attendee names from Google 'Other
> contacts'" in the plugin's Advanced settings. Used as a second, independent source
> for attendee display names — the user's own auto-populated "Other contacts" rather
> than their organization's directory — for the many Workspace domains whose admins
> disable directory access for third-party apps. Read-only, used only for name
> display, processed locally on the user's device; the plugin never adds, edits, or
> deletes contacts.

**Why not a narrower scope:** `contacts.other.readonly` is already narrower than the
full `contacts` / `contacts.readonly` scopes — it exposes only the auto-collected
"Other contacts" list, not the user's saved contacts, and grants no write access.

---

## 3. Data-handling summary (for the review form)

- No backend server exists; the plugin talks only to Google's official API endpoints
  from the user's own machine.
- Google user data is read-only, rendered in Obsidian, and stored in the user's local
  vault. OAuth tokens are stored in Obsidian per-vault local storage on the device.
- Data is never sold, shared, or used for advertising or model training.
- Adheres to the Google API Services User Data Policy, including Limited Use.
- Full policy: `https://meetingcopilot.lobato.vip/privacy.html` (see [privacy-policy.md](./privacy-policy.md)).

---

## 4. Consent screen configuration checklist

- [ ] User type: **External**, publishing status: **In production**.
- [ ] App name: **Meeting Copilot** (must match the plugin and the demo video).
- [ ] App logo uploaded (`website/assets/logo.png`, square, ≥120×120).
- [ ] User support email: `alvarolobato@gmail.com`.
- [ ] Developer contact email: `alvarolobato@gmail.com`.
- [ ] App home page: `https://meetingcopilot.lobato.vip/`.
- [ ] Privacy policy URL: `https://meetingcopilot.lobato.vip/privacy.html`.
- [ ] Terms of service URL: `https://meetingcopilot.lobato.vip/terms.html`.
- [ ] Authorized domain: `lobato.vip` — the **top private domain**, not the full
  subdomain. Verify the `lobato.vip` **domain property** in Search Console (DNS `TXT`)
  with the same Google account that owns the Cloud project; the
  `meetingcopilot.lobato.vip` home page is then covered.
- [ ] Scopes: `calendar.readonly`, `cloud-identity.groups.readonly`,
  `directory.readonly`, `contacts.other.readonly` — and nothing else. Remove `openid`,
  `.../auth/userinfo.email`, and `.../auth/userinfo.profile` if present — Cloud Console
  adds these to new consent screens by default, but the plugin's OAuth request
  (`src/auth/googleOAuth.ts`) never asks for them, so they're just unused scope
  creep that complicates review.
- [ ] Enable the **People API** and the **Cloud Identity API** on the project — the
  three optional scopes are useless without them.

### DNS + hosting for `meetingcopilot.lobato.vip`

- [ ] At the `lobato.vip` registrar/DNS, add a `CNAME`: `meetingcopilot` →
  `alvarolobato.github.io`.
- [ ] GitHub repo → **Settings → Pages**: Source = **GitHub Actions**; Custom domain =
  `meetingcopilot.lobato.vip` (GitHub writes the `CNAME` file); then **Enforce HTTPS**.
- [ ] Search Console: add `lobato.vip` as a **Domain** property and complete the DNS
  `TXT` verification.

---

## 5. Demo-video shot list

Google requires a screen-recorded video (English) proving the consent flow and the
functionality each scope enables. Record at readable resolution; narrate or caption
each step.

1. **App identity.** Show the Meeting Copilot plugin in Obsidian → Settings → Google
   Calendar integration. State the app name on camera.
2. **Start the OAuth flow.** Click **Authenticate**. The system browser opens Google's
   consent screen.
3. **Prove the consent screen.** Pause so the reviewer can see:
   - the consent screen shows the app name **Meeting Copilot**;
   - the browser address bar URL contains the app's **OAuth client ID**
     (`client_id=...apps.googleusercontent.com`).
4. **Show the optional-permission toggles first.** Before authenticating, open
   Settings → Google → Advanced → **Optional permissions** and show the three toggles
   (group expansion, Workspace directory, "Other contacts"), stating that each one
   controls whether its scope is requested at all.
5. **Grant the scopes.** Show each requested permission on the consent screen and
   approve. Show the "authentication complete" return to Obsidian.
6. **Show the functionality each scope enables:**
   - `calendar.readonly` — the agenda sidebar populating with real calendar events;
     creating a meeting note from an event (title, time, attendees filled in); a
     meeting start/stop prompt appearing around an event time.
   - `cloud-identity.groups.readonly` — an event invited via a group
     (e.g. `team@company.com`) whose note lists the individual members.
   - `directory.readonly` / `contacts.other.readonly` — an attendee whose invite
     carries only an email address showing a real display name in the note.
7. **Toggle one off to prove it's optional.** Turn a toggle off, re-authenticate, and
   show that permission is no longer on the consent screen and the plugin still works
   (that attendee falls back to a name derived from their email address).
8. **Read-only + local.** State that the plugin only reads this data, never writes to
   the calendar, contacts, or groups, and stores everything locally with no server.

---

## 6. Human-side checklist (mirrors issue #143)

- [ ] A1 — Buy domain / A2 — Enable Pages / A3 — DNS records.
- [ ] B1–B6 — Cloud project, consent screen, Search Console domain, enable APIs,
  test users.
- [ ] C1 — Record video (this shot list) / C2 — Paste justifications / C3 — Publish +
  submit + handle review replies.
