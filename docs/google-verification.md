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

**Published app: `calendar.readonly` always, plus two user-togglable attendee-name
scopes.**

All requested scopes are **Sensitive** (not Restricted), so this is standard
verification — **no** paid third-party CASA security assessment.

| Scope | Classification | In published app? | Notes |
| --- | --- | --- | --- |
| `.../auth/calendar.readonly` | Sensitive | ✅ Always | Core: read agenda, create notes, meeting prompts. |
| `.../auth/cloud-identity.groups.readonly` | Sensitive | ✅ Opt-in toggle | Expand group invitees into members. |
| `.../auth/directory.readonly` | Sensitive | ✅ Opt-in toggle | Resolve Workspace attendee display names. |

> ⚠️ Before submitting, open the consent screen and confirm each scope's label really
> is **Sensitive**. If Google has reclassified any to **Restricted**, that pulls in a
> paid annual CASA assessment — stop and reassess.

The two attendee-name scopes are requested only when the matching toggle under
**Settings → Google → Advanced → Optional permissions** is on
(`getOptionalScopes()` in `src/main.ts`); `calendar.readonly` is always requested.
Every scope is read-only and only feeds attendee-name display on the agenda.

> **Decision (2026-08-15):** supersedes the 2026-07-31 calendar-only decision. The
> optional attendee-name scopes are now part of the published app and are included in
> this verification submission, rather than being reachable only with
> bring-your-own-credentials. Each stays individually togglable in Advanced settings,
> so a user who declines them still gets a calendar-only consent screen.
>
> **Decision (2026-08-16):** `contacts.other.readonly` **dropped from the app** — it was
> a leftover from a removed attendee-photo feature and resolved almost nothing the
> directory scope doesn't already cover. Tell the reviewer to remove it from the
> request.

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
- [ ] Scopes: `calendar.readonly`, `cloud-identity.groups.readonly`, and
  `directory.readonly` — and nothing else. Remove `openid`,
  `.../auth/userinfo.email`, and `.../auth/userinfo.profile` if present — Cloud Console
  adds these to new consent screens by default, but the plugin's OAuth request
  (`src/auth/googleOAuth.ts`) never asks for them, so they're just unused scope
  creep that complicates review.
- [ ] Enable the **People API** and the **Cloud Identity API** on the project — the
  two optional scopes are useless without them.

### DNS + hosting for `meetingcopilot.lobato.vip`

- [ ] At the `lobato.vip` registrar/DNS, add a `CNAME`: `meetingcopilot` →
  `alvarolobato.github.io`.
- [ ] GitHub repo → **Settings → Pages**: Source = **GitHub Actions**; Custom domain =
  `meetingcopilot.lobato.vip` (GitHub writes the `CNAME` file); then **Enforce HTTPS**.
- [ ] Search Console: add `lobato.vip` as a **Domain** property and complete the DNS
  `TXT` verification.

---

## 5. Why two scopes (the necessity argument)

The 2026-08 review rejection was **not** "we don't believe the feature exists" — it was
*"the video does not demonstrate why the scope is necessary or why narrower permissions
cannot be used."* So the video's job is to prove each scope does something the other
cannot.

`contacts.other.readonly` has since been **removed from the app entirely** (it was a
leftover from a dropped attendee-photo feature), which leaves two, and a story that
happens to be a clean three-step chain on a single calendar invite:

| State | What the invite's guest list shows | Missing capability |
| --- | --- | --- |
| Calendar access only | **one** entry — the group's own address | Who is in the group? |
| `+ cloud-identity.groups.readonly` | **three** entries, labelled from their email addresses | What are these people called? |
| `+ directory.readonly` | **three** entries with real profile names | — |

Read as a chain, each scope answers exactly one question and neither answers the
other's:

- **`cloud-identity.groups.readonly`** — Calendar returns a group invitee as a *single
  attendee*, the group's address. No Calendar or People scope can list a group's
  members; only Cloud Identity can.
- **`directory.readonly`** — Cloud Identity's `memberships.list` returns
  `preferredMemberKey.id` and `type`, i.e. **email addresses and nothing else**. The
  group scope therefore cannot produce a name, and the app is left guessing one from the
  email local part. Only the directory turns those addresses into real people.

Both are read-only, and each is individually togglable in the app — Meeting Copilot
**is** the "least privilege auth model" case the rejection email invites us to flag. Say
so explicitly in the reply and show the toggles on camera.

---

## 6. Demo data to prepare

### You can invent the people. You cannot invent the accounts.

Both scopes resolve against **real Google-side data**, so a made-up address that doesn't
exist resolves to nothing and the shot proves nothing. Make up the *identities* freely —
a Workspace user called "Sophie Chen" who exists only for this demo is completely fine —
but actually create each account.

### The group must be a Workspace group, not a public one

The plugin calls `cloudidentity.googleapis.com/v1/groups:lookup?groupKey.id=<email>`
(see `expandGroupAttendees.ts`). Cloud Identity resolves groups belonging to a Cloud
Identity / Workspace customer. A **public consumer group** created on groups.google.com
(`…@googlegroups.com`) is not one of those and will fail lookup.

Create it **inside the demo Workspace domain** — Admin console → Directory → Groups, or
groups.google.com while signed in as a domain user with group-creation rights.

### The cast — one group, three members, nothing else

Substitute your real Workspace domain for `<demo-domain>`.

| Role | Address | Profile name | Shows as, before |
| --- | --- | --- | --- |
| Signed-in user | `alex.moreno@<demo-domain>` | Alex Moreno | — |
| The group | `product-team@<demo-domain>` | — | "Product Team" |
| Member 1 | `schen@<demo-domain>` | **Sophie Chen** | "Schen" |
| Member 2 | `rpatel@<demo-domain>` | **Raj Patel** | "Rpatel" |
| Member 3 | `mokafor@<demo-domain>` | **Mia Okafor** | "Mokafor" |

> ⚠️ **Do not use dotted addresses like `sophie.chen@`.** With no scope granted the app
> falls back to `humanizeEmailName()`, which splits the local part on `. _ + -` and
> title-cases it — so `sophie.chen@` renders as "Sophie Chen", *character-for-character
> identical* to her directory profile name. Granting `directory.readonly` would then
> change nothing on screen and the shot would prove nothing.
>
> Initial-style local parts (`schen@` → "Schen") keep the guess visibly wrong. The gap
> between the guess and the real name **is** the evidence.

### The one meeting

Create a single event — **"Q3 planning review"** — on Alex's calendar, timed inside the
agenda's look-ahead window, with **exactly one guest: the group**. Nothing else. The
whole story plays out on that one row.

### Stopping Calendar from supplying the name itself

`mapAttendeesExpanded()` prefers Calendar's own `attendee.displayName` over any lookup.
If Calendar returns a name, **no API call happens at all**.

That matters less now the only direct guest is the group, but the expanded members must
still arrive nameless — and they will, since they were never invited individually.

**Deterministic way — create the event via the API.** At
[script.google.com](https://script.google.com), signed in as the demo user, enable the
**Calendar** advanced service and run:

```js
function createDemoEvent() {
  Calendar.Events.insert({
    summary: "Q3 planning review",
    start: { dateTime: "2026-08-20T10:00:00+02:00" },
    end:   { dateTime: "2026-08-20T11:00:00+02:00" },
    attendees: [{ email: "product-team@<demo-domain>" }],
  }, "primary");
}
```

**Verifying costs nothing, because the baseline shot is the test.** With both toggles
off and `_mcDev.disableCache()` on, the agenda must show a single **"Product Team"** row.

### Turn off caching before you record

Resolved names persist ~365 days (people) / 7 days (groups), so a rehearsal poisons every
later "before" shot. Open DevTools (Cmd+Opt+I) and run:

```js
_mcDev.disableCache()   // every refresh re-queries Google
_mcDev.status()         // confirm bypass: true, and which scopes are granted
```

Leave it on for the whole recording. It doesn't persist — re-run it after any plugin
reload.

---

## 7. Demo-video shot list

`calendar.readonly` is already verified — this video is **only** about the two scopes
under review, so don't spend time re-demonstrating agenda or note features.

One meeting, one guest, three sign-ins, roughly **3 minutes**. Text cards between shots
carry the argument (there is no voice-over): see
[verification-video-cards.md](./verification-video-cards.md).

### Shot 1 — Identity and least privilege (~35s)

> **CARD 1** (title) → **CARD 2** (what this video shows)

- Obsidian → Settings → Meeting Copilot → Google Calendar integration. App name visible.
- Open **Advanced → Optional permissions**, show both toggles, **both off**.

### Shot 2 — Baseline: one address, no people (~45s)

> **CARD 3** (both toggles off)

- Click **Authenticate**. Pause on the consent screen long enough to read the URL's
  `client_id=…` and to see the permission list contains **calendar access only**.
  Approve.
- Open the agenda and show **"Q3 planning review"**. Its guest list is a single row:
  **"Product Team"**. The meeting has three actual participants and the app can name
  none of them.

> **CARD 4** (what you just saw)

### Shot 3 — `cloud-identity.groups.readonly` → addresses (~45s)

> **CARD 5**

- Turn on **only** "Expand Google Group invitees" → **Re-authenticate**.
- Consent screen now lists that one extra permission. Approve.
- Same agenda entry: one row becomes **three** — "Schen", "Rpatel", "Mokafor".
- **Narrate via the card:** we now know *who* is in the meeting, but only as email
  addresses. Cloud Identity returns member keys, not names.

### Shot 4 — `directory.readonly` → real names (~45s)

> **CARD 6**

- Turn on **only** "Resolve attendee names from your Workspace directory" →
  **Re-authenticate** → approve.
- The same three rows become **"Sophie Chen"**, **"Raj Patel"**, **"Mia Okafor"**.
- Optionally create the meeting note here to show the resolved names written into the
  vault — the end product the user actually keeps.

### Shot 5 — Read-only and local (~20s)

> **CARD 7** (read-only + local) → **CARD 8** (summary)

- Nothing to perform; hold the cards. Optionally show `directory-cache.json` in the
  vault folder as the only place any of this is stored.

### Checklist before you stop recording

- [ ] `client_id=…` legible in the consent URL at least once.
- [ ] Consent screen visible for calendar-only **and** for each of the two additions.
- [ ] The same guest list shown in all three states, in the same view.
- [ ] Baseline really showed one "Product Team" row — not three people.
- [ ] After the group grant, rows really read "Schen"/"Rpatel"/"Mokafor" — not real names.
- [ ] A statement that nothing is written back to Google.

---

## 8. Replying to the review email

Reply directly to the thread with:

1. The new video link (unlisted YouTube or Drive link with link-sharing on).
2. **`contacts.other.readonly` has been removed from the app** — please drop it from the
   request. That alone answers one third of the objection.
3. A statement that Meeting Copilot implements a **least-privilege model with per-scope
   user toggles** — the case their email explicitly asks to be told about.
4. The chain argument from §5: the group scope returns member *addresses only*
   (`memberships.list` → `preferredMemberKey.id`), so it cannot produce names; the
   directory scope has no way to discover group membership. Neither substitutes for the
   other, and no narrower scope exists for either job.
5. **Test credentials + navigation steps.** The app is a local macOS desktop plugin, so
   there is no hosted URL to hand over. Provide the demo Workspace account credentials
   (2FA and recovery prompts removed) and numbered steps — install Obsidian, install the
   plugin, open Settings → Meeting Copilot → Google Calendar integration → Advanced →
   Optional permissions, toggle, Authenticate. Say plainly that it requires macOS and a
   local Obsidian install, so the video is the primary evidence.
6. A note that the scopes actually sent are computed per sign-in from the user's toggles
   (`getOptionalScopes()` in `src/main.ts`), so a user who wants only calendar access
   gets a calendar-only consent screen.

---

## 9. Human-side checklist (mirrors issue #143)

- [ ] A1 — Buy domain / A2 — Enable Pages / A3 — DNS records.
- [ ] B1–B6 — Cloud project, consent screen, Search Console domain, enable APIs,
  test users.
- [ ] C1 — Record video (this shot list) / C2 — Paste justifications / C3 — Publish +
  submit + handle review replies.
