# Verification video — on-screen cards

Full-screen text to display **between** shots, since the video has no voice-over. Copy
this file into a vault, open it in **Reading view**, and zoom in (Cmd +) until a card
fills the screen.

Cards are separated by `---`. If your Obsidian version still ships the **Slides** core
plugin, "Open as slides" turns this file into a deck that advances one card at a time;
otherwise scroll card to card.

Nine cards, ~55 seconds of card time total. `HOLD` times are HTML comments and don't
render. Cards map onto the shot list in
[google-verification.md](./google-verification.md) §7.

Everything above the first horizontal rule is instructions — it does not go on screen.

---

# Meeting Copilot

### Google OAuth verification demo

An **Obsidian plugin for macOS**. Meetings become recorded,
transcribed, summarized notes — on the user's own device.

**No backend server. Nothing is ever written back to Google.**

<!-- HOLD 7s -->

---

# The three scopes under review

`cloud-identity.groups.readonly`
`directory.readonly`
`contacts.other.readonly`

### One job: show a **real person's name** on the meeting agenda instead of a raw email address.

**One meeting, three guests — each resolvable by exactly one of these scopes.**
Watch the same guest list through the whole video.

<!-- HOLD 10s -->

---

# Every permission is optional

Each has its **own toggle** in the app's settings.
The scopes sent are computed **per sign-in** from those toggles.

### Starting with all three OFF.

Expect a **calendar-only** consent screen.

<!-- HOLD 8s -->

---

# Baseline: what you just saw

With calendar access alone, all three guests are unusable:

**`product-team@…`** — a raw group address. No people.

**Sophie** — a name *guessed* from the email address.

**Dana** — likewise a guess.

### This is the maximum the app can do without the three permissions.

<!-- HOLD 11s -->

---

# Scope 1 of 3

## `cloud-identity.groups.readonly`

**Turning ON:** "Expand Google Group invitees"

**Watch:** `product-team@` becomes the three people actually in it.

**Why nothing narrower works:** Calendar returns the group as a *single
attendee*. No Calendar or People scope can list a group's members —
only Cloud Identity can.

<!-- HOLD 12s -->

---

# Scope 2 of 3

## `directory.readonly`

**Turning ON:** "Resolve attendee names from your Workspace directory"

**Watch:** Sophie resolves to her real Workspace profile name…

### …and Dana does **not**.

She is external. The Workspace directory does not contain her.

<!-- HOLD 12s -->

---

# Scope 3 of 3

## `contacts.other.readonly`

**Turning ON:** "Resolve attendee names from Google 'Other contacts'"

**Watch:** Dana resolves — from the user's own contacts, not the directory.

**Why the previous scope could not do this:** external people are
**by definition absent** from the Workspace directory.

It is also the **only** fallback when a Workspace admin
disables directory sharing for third-party apps.

<!-- HOLD 13s -->

---

# Read-only, and local

The plugin **never** creates, edits, or deletes
calendar events, contacts, or groups.

Everything read stays in the user's **local Obsidian vault**,
on their own Mac.

**There is no Meeting Copilot server.**

<!-- HOLD 9s -->

---

# Summary

| Scope | Resolves what nothing else can |
| --- | --- |
| `cloud-identity.groups.readonly` | the people behind a group address |
| `directory.readonly` | internal colleagues the invite didn't name |
| `contacts.other.readonly` | external guests, absent from the directory |

### Each one optional. Each one read-only.

**Meeting Copilot** · meetingcopilot.lobato.vip/privacy.html

<!-- HOLD 12s -->
