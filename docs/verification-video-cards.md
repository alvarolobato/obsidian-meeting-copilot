# Verification video — on-screen cards

Full-screen text to display **between** shots, since the video has no voice-over.

## Use the rendered cards, not this file

`verification-cards/render.sh` renders each card below to a 3840x2160 PNG named
with its hold time (`card-01-hold-7s.png` …). Drop those into the video editor as
stills and set each clip to the duration in its filename.

That beats presenting from Obsidian: the hold times become exact clip lengths
instead of mistimed keypresses, there is no cursor or app chrome in frame, and
re-cutting one card costs nothing. Obsidian's **Slides** core plugin still exists
but is deprecated, is off by default, and cannot hold a card for a set time.

```bash
docs/verification-cards/render.sh        # → docs/verification-cards/png/
open docs/verification-cards/deck.html   # arrow keys / click to advance, F for fullscreen
```

Edit the card text in [`verification-cards/deck.html`](./verification-cards/deck.html)
and re-render — that file is the source the PNGs come from. The markdown below is
the readable copy of the same eight cards; keep the two in sync.

Eight cards, **85 seconds** of card time total. Cards map onto the shot list in
[google-verification.md](./google-verification.md) §7. `HOLD` times below match the
`data-hold` attributes in the deck.

Everything above the first horizontal rule is instructions — it does not go on screen.

---

# Meeting Copilot

### Google OAuth verification demo

An **Obsidian plugin for macOS**. Meetings become recorded,
transcribed, summarized notes — on the user's own device.

**No backend server. Nothing is ever written back to Google.**

<!-- HOLD 7s -->

---

# One meeting. One guest. Three states.

A calendar invite addressed to a **Google Group**.

**Now:** the app sees one email address.
**Goal:** three people, by name, in the meeting note.

### Each scope closes exactly one of those two gaps.

`cloud-identity.groups.readonly` → who is in the group
`directory.readonly` → what those people are called

<!-- HOLD 11s -->

---

# Every permission is optional

Each has its **own toggle** in the app's settings.
The scopes sent are computed **per sign-in** from those toggles.

### Starting with both OFF.

Expect a **calendar-only** consent screen.

<!-- HOLD 8s -->

---

# State 1 — calendar access only

The invite's guest list is a **single row**:

## "Product Team"

Three people are in this meeting.
The app can name **none** of them, and cannot even tell you how many there are.

<!-- HOLD 10s -->

---

# State 2 — adding groups access

## `cloud-identity.groups.readonly`

**Turning ON:** "Expand Google Group invitees"

**Watch:** one row becomes **three**.

**Why nothing narrower works:** Calendar returns the group as a *single
attendee*. No Calendar or People scope can list a group's members —
only Cloud Identity can.

<!-- HOLD 12s -->

---

# State 2, continued — we have addresses, not names

## "Schen" · "Rpatel" · "Mokafor"

We now know **who** is in the meeting — but only as email addresses.

Cloud Identity's `memberships.list` returns **member keys only**.
There is no name anywhere in that response.

### So the app is guessing these labels from the email addresses.

<!-- HOLD 12s -->

---

# State 3 — adding directory access

## `directory.readonly`

**Turning ON:** "Resolve attendee names from your Workspace directory"

**Watch:** the same three rows become

## Sophie Chen · Raj Patel · Mia Okafor

**Why the group scope could not do this:** it returns addresses, never names.
**Why this scope alone is not enough:** it has no way to discover
who belongs to a group in the first place.

<!-- HOLD 14s -->

---

# Read-only, and local

The plugin **never** creates, edits, or deletes
calendar events, contacts, or groups.

Everything read stays in the user's **local Obsidian vault**,
on their own Mac.

**There is no Meeting Copilot server.**

### Two permissions. Both optional. Both read-only.

**Meeting Copilot** · meetingcopilot.lobato.vip/privacy.html

<!-- HOLD 11s -->
