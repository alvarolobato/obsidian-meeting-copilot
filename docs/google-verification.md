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

**Default published app: `calendar.readonly` only.**

All requested scopes are **Sensitive** (not Restricted), so this is standard
verification — **no** paid third-party CASA security assessment. Shipping the
verified app with a single, self-evident scope minimizes review friction.

| Scope | Classification | In default app? | Notes |
| --- | --- | --- | --- |
| `.../auth/calendar.readonly` | Sensitive | ✅ Yes | Core: read agenda, create notes, meeting prompts. |
| `.../auth/directory.readonly` | Sensitive | ❌ Advanced only | Resolve Workspace attendee display names. BYO-credentials. |
| `.../auth/cloud-identity.groups.readonly` | Sensitive | ❌ Advanced only | Expand group invitees into members. BYO-credentials. |

> ⚠️ Before submitting, open the consent screen and confirm each scope's label really
> is **Sensitive**. If Google has reclassified any to **Restricted**, that pulls in a
> paid annual CASA assessment — stop and reassess.

The directory/group scopes stay available for users who supply their own Google Cloud
credentials (Advanced settings), so power users keep name/group resolution without
those scopes touching the published app's verification.

> **Decision (2026-07-31):** verified app = **calendar-only**. The plugin-side change
> that narrows the default requested scopes to calendar-only (keeping directory/groups
> as a bring-your-own-credentials opt-in) is **owned by a separate app-code PR**, not
> this docs/site branch. This pack assumes that change ships before submission.

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

### (Advanced only) `https://www.googleapis.com/auth/directory.readonly`

> Requested only when a user configures the plugin with their own Google Cloud
> project. Used to resolve a Google Workspace attendee's display name from their email
> address when Google Calendar did not include the name, so meeting notes show real
> names instead of email addresses. Read-only, used only for name display, processed
> locally.

### (Advanced only) `https://www.googleapis.com/auth/cloud-identity.groups.readonly`

> Requested only for bring-your-own-credentials users. Used to expand a group invited
> to a meeting (e.g. `team@company.com`) into its individual members so the meeting
> note lists the actual attendees. Read-only, processed locally.

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
- [ ] Scopes: `calendar.readonly` (only).

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
4. **Grant `calendar.readonly`.** Show the requested permission ("See your calendar
   events") and approve. Show the "authentication complete" return to Obsidian.
5. **Show the functionality the scope enables:**
   - the agenda sidebar populating with real calendar events;
   - creating a meeting note from an event (title, time, attendees filled in);
   - a meeting start/stop prompt appearing around an event time.
6. **Read-only + local.** State that the plugin only reads calendar data, never
   writes to the calendar, and stores everything locally with no server.

---

## 6. Human-side checklist (mirrors issue #143)

- [ ] A1 — Buy domain / A2 — Enable Pages / A3 — DNS records.
- [ ] B1–B6 — Cloud project, consent screen, Search Console domain, enable APIs,
  test users.
- [ ] C1 — Record video (this shot list) / C2 — Paste justifications / C3 — Publish +
  submit + handle review replies.
