# Verification video — on-screen cards

Full-screen text to display **between** shots, since the video has no voice-over. Copy
this file into a vault, open it in **Reading view**, and zoom in (Cmd +) until a card
fills the screen.

Cards are separated by `---`. If your Obsidian version still ships the **Slides** core
plugin, "Open as slides" turns this file into a deck that advances one card at a time;
otherwise just scroll card to card.

**Holding times** are the minimum a reviewer needs to read it — hold longer if in doubt.
Total card time is roughly 75 seconds; the whole video should land around 6–9 minutes.

Cards map 1:1 onto the shot list in [google-verification.md](./google-verification.md) §7.
Everything below the horizontal rule is the script — nothing above it goes on screen.

---

# Meeting Copilot

### Google OAuth verification demo

An **Obsidian plugin for macOS** that turns calendar meetings into
recorded, transcribed, summarized notes — entirely on the user's own device.

**No backend server. Nothing is ever written back to Google.**

<!-- HOLD 8s -->

---

# What this video shows

**1.** Every permission is optional and user-controlled

**2.** What the app can do with **calendar access only**

**3.** Each additional scope, granted one at a time —
and the attendee that **only that scope** can resolve

**4.** Turning a permission back off

<!-- HOLD 10s -->

---

# The three scopes under review

`cloud-identity.groups.readonly`

`directory.readonly`

`contacts.other.readonly`

### All three do one job: show a **real person's name** on the agenda instead of a raw email address.

### All three are read-only.

<!-- HOLD 10s -->

---

# 1 · Least privilege, by design

Each permission has its **own toggle** in the app's settings.

The scopes sent to Google are computed **per sign-in** from those toggles.

A user who wants only their calendar
gets a **calendar-only consent screen**.

<!-- HOLD 9s -->

---

# 1 · Now: all three toggles OFF

Watch the consent screen request
**calendar access only**.

<!-- HOLD 5s -->

---

# 2 · The baseline

This is the **maximum** the app can do
without the three permissions.

Watch the attendee names.

<!-- HOLD 5s -->

---

# 2 · What you just saw

**Product sync** → shows `product-team@…`
a raw group address. No people.

**Partner review** → shows names **guessed** from the
email address, not real profile names.

<!-- HOLD 9s -->

---

# 3 · Scope 1 of 3

## `cloud-identity.groups.readonly`

### Turning ON: "Expand Google Group invitees"

**What it does:** shows who is actually behind a group address on an invite.

**Why nothing narrower works:** Calendar returns the group as a *single attendee*.
No Calendar or People scope can list a group's members. Only Cloud Identity can.

<!-- HOLD 12s -->

---

# 3 · Scope 2 of 3

## `directory.readonly`

### Turning ON: "Resolve attendee names from your Workspace directory"

**What it does:** looks up a colleague's real display name
when the invite carries only an email address.

**Watch:** the **external** attendee stays unresolved.
The directory does not contain people outside the organization.

<!-- HOLD 12s -->

---

# 3 · Scope 3 of 3

## `contacts.other.readonly`

### Turning ON: "Resolve attendee names from Google 'Other contacts'"

**What it does:** resolves the **external** attendee — a customer or partner —
from the user's own contacts.

**Why the previous scope could not do this:** external people are
**by definition absent** from the Workspace directory.

It is also the **only** fallback when a Workspace admin
disables directory sharing for third-party apps.

<!-- HOLD 14s -->

---

# 4 · Turning a permission back off

The permission disappears from the consent screen.

The attendee falls back to a guessed name.

**The app keeps working.**

<!-- HOLD 8s -->

---

# Read-only, and local

The plugin **never** creates, edits, or deletes
calendar events, contacts, or groups.

Everything read is stored **only** in the user's
local Obsidian vault, on their own Mac.

**There is no Meeting Copilot server.**

<!-- HOLD 10s -->

---

# Summary

| Scope | Resolves what nothing else can |
| --- | --- |
| `cloud-identity.groups.readonly` | the people behind a group address |
| `directory.readonly` | internal colleagues the invite didn't name |
| `contacts.other.readonly` | external attendees, absent from the directory |

### Each one optional. Each one read-only.

<!-- HOLD 12s -->

---

# Thank you

**Meeting Copilot**

Privacy policy: `meetingcopilot.lobato.vip/privacy.html`

<!-- HOLD 5s -->
