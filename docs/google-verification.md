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

---

## 6. Demo data to prepare

### You can invent the people. You cannot invent the accounts.

Every one of the three scopes resolves against **real Google-side data**, so a made-up
address that doesn't exist resolves to nothing and the shot proves nothing:

- `directory.readonly` returns only real users in the real Workspace directory.
- `contacts.other.readonly` returns only addresses Google has actually filed under the
  signed-in user's **Other contacts** — which happens from real received mail, and only
  carries a *name* if the sender had a display name set.
- `cloud-identity.groups.readonly` needs a real group with real memberships.

So: make up the *identities* freely — a Workspace user called "Sophie Chen" who exists
only for this demo is completely fine — but actually create each account.

### The group: it must be a Workspace group, not a public one

The plugin calls `cloudidentity.googleapis.com/v1/groups:lookup?groupKey.id=<email>`
(see `expandGroupAttendees.ts`). Cloud Identity resolves groups belonging to a Cloud
Identity / Workspace customer. A **public consumer group** created on groups.google.com
(`…@googlegroups.com`) is not one of those and will fail lookup.

Create the group **inside the demo Workspace domain** — Admin console → Directory →
Groups, or groups.google.com while signed in as a domain user with group-creation
rights. Suggested name: **`product-team@<your-demo-domain>`**.

### The cast — one meeting, three guests, one scope each

Substitute your real Workspace domain for `<demo-domain>`.

| Role | Suggested address | Resolvable only by |
| --- | --- | --- |
| Signed-in user | `alex.moreno@<demo-domain>` | — (the account that authenticates) |
| Workspace group | `product-team@<demo-domain>` | `cloud-identity.groups.readonly` |
| Internal colleague | `sophie.chen@<demo-domain>` | `directory.readonly` |
| External contact | `dana.whitfield@gmail.com` | `contacts.other.readonly` |

Group members: `sophie.chen@`, `raj.patel@`, `mia.okafor@` — three is enough to make an
expansion visibly different from a single address.

**Dana is the one that takes lead time.** She must be a real mailbox (a second free
Gmail account is fine) with the profile name set to "Dana Whitfield", and she must
**send mail to `alex.moreno@`** — receiving is what makes Google file her under Other
contacts with a name. Before recording, confirm at
[contacts.google.com → Other contacts](https://contacts.google.com/other) that she is
listed **with a name**, not just an address. If she shows as a bare address, the third
scope has nothing to demonstrate.

### The one meeting

Create a single event — **"Q3 planning review"** — on Alex's calendar, timed inside the
agenda's look-ahead window, with exactly three guests: `product-team@`, `sophie.chen@`,
`dana.whitfield@gmail.com`.

Add them by **pasting bare email addresses**. If Calendar attaches a `displayName` of
its own, the plugin uses it and skips the lookup — which would make the whole video
prove nothing.

This single event is what makes the recording short: all three failure modes are visible
in one attendee list, and each toggle then fixes exactly one row of it.

### Turn off caching before you record

Resolved names persist ~365 days (people) / 7 days (groups), so a rehearsal poisons
every later "before" shot. Open DevTools (Cmd+Opt+I) and run:

```js
_mcDev.disableCache()   // every refresh re-queries Google
_mcDev.status()         // confirm bypass: true
```

Leave it on for the whole recording. It doesn't persist — re-run it after any plugin
reload. It deliberately leaves Other-contacts names visible, since those come from a
bulk sync rather than per-person lookups.

---

## 7. Demo-video shot list

`calendar.readonly` is already verified — this video is **only** about the three scopes
under review, so don't spend time re-demonstrating agenda or note features.

One meeting, four sign-ins, roughly **4 minutes**. Text cards between shots carry the
argument (there is no voice-over): see
[verification-video-cards.md](./verification-video-cards.md).

### Shot 1 — Identity and least privilege (~40s)

> **CARD 1** (title) → **CARD 2** (what this video shows)

- Obsidian → Settings → Meeting Copilot → Google Calendar integration. App name visible.
- Open **Advanced → Optional permissions**, show the three toggles, **all off**.

### Shot 2 — Baseline: calendar only (~50s)

> **CARD 3** (all toggles off)

- Click **Authenticate**. Pause on the consent screen long enough to read the URL's
  `client_id=…` and to see the permission list contains **calendar access only**.
  Approve.
- Open the agenda and show **"Q3 planning review"**. All three guests are degraded at
  once:
  - `product-team@…` — a raw group address, no people;
  - "Sophie Chen" — a *guess* from the email local part, not a profile name;
  - "Dana Whitfield" — likewise a guess, or just "Dana".

> **CARD 4** (what you just saw)

### Shot 3 — `cloud-identity.groups.readonly` (~40s)

> **CARD 5**

- Turn on **only** "Expand Google Group invitees" → **Re-authenticate**.
- Consent screen now lists that one extra permission. Approve.
- Same agenda entry: `product-team@` is replaced by Sophie, Raj, and Mia.

### Shot 4 — `directory.readonly` (~40s)

> **CARD 6**

- Turn on **only** "Resolve attendee names from your Workspace directory" →
  **Re-authenticate** → approve.
- Sophie now shows her real Workspace profile name.
- **Hold on the list**: Dana is still unresolved. This is the shot that proves the third
  scope is not redundant — don't rush it.

### Shot 5 — `contacts.other.readonly` (~40s)

> **CARD 7**

- Turn on **only** "Resolve attendee names from Google 'Other contacts'" →
  **Re-authenticate** → approve.
- Dana resolves to her real name. Every guest on the meeting is now a real person.

### Shot 6 — Read-only and local (~20s)

> **CARD 8** (read-only + local) → **CARD 9** (summary)

- Nothing to perform; hold the cards. Optionally show `directory-cache.json` in the
  vault folder as the only place any of this is stored.

### Checklist before you stop recording

- [ ] `client_id=…` legible in the consent URL at least once.
- [ ] Consent screen visible for calendar-only **and** for each of the three additions.
- [ ] The same three-guest list shown before and after every grant.
- [ ] Group address → three named members.
- [ ] Dana unresolved *after* the directory grant, resolved *after* the other-contacts grant.
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
5. A note that the scopes actually sent are computed per sign-in from the user's
   toggles (`getOptionalScopes()` in `src/main.ts`), so a user who wants only calendar
   access gets a calendar-only consent screen.

---

## 9. Human-side checklist (mirrors issue #143)

- [ ] A1 — Buy domain / A2 — Enable Pages / A3 — DNS records.
- [ ] B1–B6 — Cloud project, consent screen, Search Console domain, enable APIs,
  test users.
- [ ] C1 — Record video (this shot list) / C2 — Paste justifications / C3 — Publish +
  submit + handle review replies.
