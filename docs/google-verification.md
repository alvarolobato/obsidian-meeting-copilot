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

## 5. Why three scopes (the necessity argument)

The 2026-08 review rejection was **not** "we don't believe the feature exists" — it was
*"the video does not demonstrate why the scope is necessary or why narrower permissions
cannot be used."* So the video's job is to prove each scope resolves a population the
other two **cannot**. Say this on camera, and structure the shots around it:

| Scope | Resolves | Why nothing narrower works |
| --- | --- | --- |
| `cloud-identity.groups.readonly` | The people behind a **group address** on an invite | Calendar returns the group's email as a single attendee. No Calendar or People scope can list a group's members; only Cloud Identity can. |
| `directory.readonly` | Display names of **internal colleagues** Calendar didn't label | These people are in the org directory but not in the user's own contacts, so `contacts.readonly` / `contacts.other.readonly` return nothing for them. |
| `contacts.other.readonly` | Display names of **external people** (customers, partners) | External attendees are **by definition absent** from the Workspace directory, so `directory.readonly` cannot resolve them. It is also the only fallback when a Workspace admin disables directory sharing for third-party apps. |

Every one of the three is read-only, and each is individually togglable in the app —
Meeting Copilot **is** the "least privilege auth model" case the rejection email invites
us to flag. Say so explicitly in the reply and show the toggles on camera.

> ⚠️ **Before recording, check the shipped defaults.** The rejection email says *"do not
> deploy unverified scopes to production traffic."* `OPTIONAL_SCOPES_DEFAULT` in
> `src/settings.ts` is currently `true`, so every released install requests all three
> unverified scopes at sign-in. Either flip that default to `false` before the next
> release (production traffic goes back to calendar-only; the demo build turns them on
> explicitly), or be ready to explain the current behaviour. Leaving it as-is burns the
> unverified-user cap and is the exact pattern the email warns against.

---

## 6. Demo data to prepare

The demo needs a **Google Workspace domain** (a throwaway one is fine) plus one external
address. The point of the cast below is that each attendee is resolvable by exactly one
scope.

### Accounts and groups

| What | Example | Purpose |
| --- | --- | --- |
| Signed-in user | `demo@<workspace-domain>` | The account that authenticates in the video. Remove 2FA prompts / recovery nags so a reviewer could repeat it. |
| Internal colleague | `sophie.chen@<workspace-domain>` | Has a directory profile with a **full display name**. Resolvable **only** by `directory.readonly`. |
| Second internal member | `raj.patel@<workspace-domain>` | Group member, so the expanded group shows more than one person. |
| Google Group | `product-team@<workspace-domain>` | 3+ members. Resolvable **only** by `cloud-identity.groups.readonly`. |
| External contact | `dana@<partner-domain>` | **Not** in the Workspace directory. Exchange a real email with them from the demo account first so Google files them under **Other contacts** with a display name. Resolvable **only** by `contacts.other.readonly`. |

Verify the external contact really landed in Other contacts before recording:
Google Contacts → **Other contacts** should list Dana with a name. If it shows only an
email address, the video has nothing to demonstrate — send another round of email and
wait for Google to populate it.

### Calendar events

Create these on the demo account's calendar, timed to be visible in the agenda's
look-ahead window while recording:

1. **"Product sync"** — invite **only** the group `product-team@…`.
2. **"Partner review"** — invite `sophie.chen@…` and `dana@…`, **pasting bare email
   addresses** so Calendar attaches no `displayName` of its own. If Calendar supplies a
   name, the plugin uses it and no lookup happens — which would make the shot prove
   nothing.

### Cache reset — the single biggest recording gotcha

Resolved names persist in `<vault>/.obsidian/plugins/meeting-copilot/directory-cache.json`
for **~365 days** (people) and **7 days** (groups). Toggling a scope off clears session
state and *negative* entries only — **positive hits survive**, so an attendee resolved
during a rehearsal still shows their real name with the scope switched off, and the
"before" shot silently proves nothing.

Before every "before" take: quit Obsidian, delete `directory-cache.json`, reopen.

Deleting it also resets the Other-contacts sync timestamp, which otherwise only re-runs
once per 24h.

### Also have ready

- A second Google account to act as organizer, if you want invites with no display name.
- The OAuth **client ID** visible in the browser URL bar during consent.
- Screen recording at a resolution where the agenda's attendee names are legible.

---

## 7. Demo-video shot list

Record in English, narrated or captioned. The structure is deliberately
**off → consent → on** per scope: that contrast is the necessity evidence the reviewer
asked for. Budget roughly 6–9 minutes.

### Part 1 — Identity and the least-privilege model

1. **App identity.** Obsidian → Settings → Meeting Copilot → Google Calendar
   integration. State "Meeting Copilot" on camera.
2. **Show the toggles.** Open **Advanced → Optional permissions** and show all three
   toggles, narrating: *"each of these three permissions is individually optional and
   off unless the user turns it on; calendar access is the only one always requested."*
3. **Turn all three OFF.** Authenticate. On the consent screen, pause on the URL so the
   **client ID** is readable, and show the permission list contains **only** calendar
   access. Approve, return to Obsidian.

### Part 2 — The baseline (what the user sees without the scopes)

4. **Show the degraded agenda.** Open the agenda sidebar with both demo events visible:
   - "Product sync" lists `product-team@…` — a raw group address, no people.
   - "Partner review" lists guessed names derived from the email local part
     (e.g. "Sophie Chen" is a *guess* from `sophie.chen@`, and `dana@` shows just
     "Dana") — not the real profile names.
   - Create a meeting note from one event so the same labels appear written into the
     note. Narrate: *"this is the maximum the app can do without the three permissions."*

### Part 3 — One scope at a time

For each scope: quit Obsidian → delete `directory-cache.json` → reopen → turn on **only**
that toggle → **Re-authenticate** → show the consent screen now lists that one extra
permission → approve → show the resulting change.

5. **`cloud-identity.groups.readonly`.** After granting, "Product sync" expands
   `product-team@…` into Sophie, Raj, and the third member, in the agenda *and* in a
   newly created note. Narrate that Calendar only ever returns the group address, so no
   Calendar or People scope can produce this list.
6. **`directory.readonly`.** After granting, Sophie on "Partner review" resolves to her
   real Workspace profile name. Point out that Dana (external) is **still** unresolved —
   this is the shot that proves the third scope is not redundant.
7. **`contacts.other.readonly`.** After granting, Dana resolves to her real name from the
   user's Other contacts. Narrate that she is external, therefore absent from the
   directory, so the previous scope could never have resolved her.

### Part 4 — Prove it's read-only and reversible

8. **Revoke one.** Turn `directory.readonly` back off, re-authenticate, and show that
   permission is gone from the consent screen and Sophie falls back to a guessed name —
   the app keeps working.
9. **Read-only + local.** State that the plugin never creates, edits, or deletes
   calendar events, contacts, or groups; that all data stays in the local Obsidian vault
   on the user's Mac; and that there is no developer server. Optionally show
   `directory-cache.json` in the vault folder as the only place this data is stored.

### What the reviewer must be able to see at least once

- [ ] Client ID legible in the consent URL.
- [ ] Consent screen with calendar-only (Part 1) and with each added scope (Part 3).
- [ ] The same attendee before and after each scope, in the same view.
- [ ] Group address → member list.
- [ ] An external attendee resolved *only* after `contacts.other.readonly`.
- [ ] A statement that nothing is written back to Google.

---

## 8. Replying to the review email

Reply directly to the thread with:

1. The new video link (unlisted YouTube or Drive link with link-sharing on).
2. A short statement that Meeting Copilot implements a **least-privilege model with
   per-scope user toggles** — the case their email explicitly asks to be told about.
3. The table from §5, as the "why nothing narrower works" argument.
4. **Test credentials + navigation steps.** The app is a local macOS desktop plugin, so
   there is no hosted URL to hand over. Provide: the demo Workspace account credentials
   (2FA and recovery prompts removed), and numbered steps — install Obsidian, install the
   plugin, open Settings → Meeting Copilot → Google Calendar integration → Advanced →
   Optional permissions, toggle, Authenticate. Say plainly that it requires macOS and a
   local Obsidian install, so the video is the primary evidence.
5. Confirmation of what production traffic requests today (see the warning in §5).

---

## 9. Human-side checklist (mirrors issue #143)

- [ ] A1 — Buy domain / A2 — Enable Pages / A3 — DNS records.
- [ ] B1–B6 — Cloud project, consent screen, Search Console domain, enable APIs,
  test users.
- [ ] C1 — Record video (this shot list) / C2 — Paste justifications / C3 — Publish +
  submit + handle review replies.
