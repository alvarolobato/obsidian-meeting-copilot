# Bring your own Google credentials

Meeting Copilot ships with a built-in Google OAuth app. For most people that is all
you need: click **Authenticate**, grant read-only calendar access, done.

There are two situations where you have to create your **own** Google Cloud OAuth
client instead:

| Situation | What you build | Go to |
| --- | --- | --- |
| You want group invitees expanded and real attendee names instead of email addresses | A Google Cloud project of your own (an **Internal** client on a Workspace account, **External** on a personal one) | [Option A](#option-a--your-own-google-cloud-project) |
| Your company blocks the built-in app ("your administrator has restricted access to this app") | An **Internal** OAuth client inside your organization's Google Cloud — or an admin allowlist | [Option B](#option-b--your-organization-wont-approve-the-built-in-app) |

Either way the result is the same two strings — a **Client ID** and a **Client
secret** — pasted into *Settings → Meeting Copilot → General → Google Calendar →
Advanced: custom OAuth credentials*.

Nothing here costs money. There is no billing account to attach, and the free quotas
are far above what one person's calendar uses.

---

## Why the built-in app isn't always enough

The published Meeting Copilot app is verified by Google for exactly one scope,
`calendar.readonly`. That is deliberate — it is the narrowest possible surface for the
thing the plugin exists to do, and it keeps the verified app easy to audit.

Everything under **Optional permissions** in settings — group expansion and attendee
name resolution — needs three *additional* scopes that the published app does not
carry. They are a bring-your-own-credentials feature: they only work against an OAuth
client you created and configured yourself.

| Optional permission (settings toggle) | Scope | Google API |
| --- | --- | --- |
| Expand Google Group invitees | `cloud-identity.groups.readonly` | Cloud Identity API |
| Resolve attendee names from your Workspace directory | `directory.readonly` | People API |
| Resolve attendee names from Google "Other contacts" | `contacts.other.readonly` | People API |

Separately, a Google Workspace admin can block *any* third-party app for the whole
organization — being verified by Google doesn't exempt an app from that. When that is
the case, no amount of configuration on our side helps: the app has to be one your
organization already trusts. That's Option B.

---

## Option A — your own Google Cloud project

Use this when you want group expansion and real attendee names, on a personal Google
account or a Workspace account whose admin allows third-party apps.

Roughly 15 minutes.

### 1. Create a project

Open the [Google Cloud Console](https://console.cloud.google.com/projectcreate) and
create a project (any name — `meeting-copilot` is fine). Make sure the project picker
at the top shows your new project for every step below.

### 2. Enable the APIs you need

Go to **APIs & Services → [Library](https://console.cloud.google.com/apis/library)**
and enable:

| API | Needed for |
| --- | --- |
| **Google Calendar API** | Always — the agenda, meeting notes, start/stop prompts |
| **Cloud Identity API** | Expanding Google Group invitees |
| **People API** | Attendee names (both directory and "Other contacts") |

Skipping one shows up later as a `SERVICE_DISABLED` error in the Obsidian console, not
as a visible failure — enable all three unless you know you don't want the feature.

### 3. Configure the consent screen

Under **[Google Auth Platform](https://console.cloud.google.com/auth/overview)** (the
Cloud Console section that used to be called "OAuth consent screen"):

- **Branding** — app name (e.g. `Meeting Copilot (my project)`), your email as user
  support contact, and a developer contact email. This is the name *you* will see on
  the consent screen, so make it recognizable.
- **Audience** — **Internal** if you're on a Google Workspace account and the project
  lives in your organization: the app belongs to your own domain, so there's no
  verification, no warning screen, and nothing more to set here. **External** otherwise
  (a personal Gmail account) — add your own account under **Test users**, since an app
  in *Testing* only works for accounts listed there.

### 4. Add the scopes

Under **Data access → Add or remove scopes**, add the ones you want. You can paste the
full URLs into the "manually add scopes" box:

```
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/cloud-identity.groups.readonly
https://www.googleapis.com/auth/directory.readonly
https://www.googleapis.com/auth/contacts.other.readonly
```

Only `calendar.readonly` is required. Add the others to match the **Optional
permissions** toggles you intend to leave on — a scope the plugin requests but the
consent screen doesn't list will fail the sign-in.

You can safely remove `openid`, `userinfo.email`, and `userinfo.profile` if the
console added them by default. The plugin never asks for them.

### 5. Create the OAuth client

**Clients → Create client → Application type: Desktop app.** Name it anything.

It has to be **Desktop app**. Meeting Copilot completes the sign-in on a loopback
address (`http://127.0.0.1:<random port>/callback`) that it opens for a few seconds
during authentication. Desktop clients accept any loopback port, so there is no
redirect URI for you to configure. A "Web application" client will reject the sign-in
with `redirect_uri_mismatch`.

Copy the **Client ID** and **Client secret** from the dialog. You can reopen them later
from the same **Clients** page.

### 6. Paste them into Obsidian

*Settings → Meeting Copilot → General → Google Calendar → **Advanced: custom OAuth
credentials***. Fill in both fields, then click **Authenticate** (or
**Re-authenticate** if you were already connected — an existing sign-in only carries
the scopes it was granted at the time, so you must reconnect for the new ones to take
effect).

An **External** app shows a **"Google hasn't verified this app"** screen the first
time. It's your own app and your own data: choose **Advanced → Go to
&lt;your app name&gt; (unsafe)** and continue. Internal apps skip it.

### 7. External only: publish the app, or re-connect every week

While an **External** app stays in *Testing*, Google expires its refresh tokens after
**7 days** — the agenda will show **Reconnect** about once a week, forever.
**Audience → Publish app** stops that; you don't need to submit anything to Google to
keep using your own app. Internal apps aren't affected.

---

## Option B — your organization won't approve the built-in app

Symptoms, all seen at the Google consent screen rather than inside Obsidian:

- *Access blocked: your administrator has restricted access to this app*
- *Meeting Copilot has not been approved by your administrator*
- `Error 403: access_denied` / `admin_policy_enforced`

This is Google Workspace's **app access control**: your admin decides which
third-party OAuth apps may touch company data, and many organizations block every app
they haven't explicitly approved. Verification status has nothing to do with it — a
Google-verified app is still a third-party app to your admin. There are two ways out.

### B1 — ask your admin to trust the app (fastest)

Nothing to build. Your Workspace admin goes to **Admin console → Security → Access and
data control → API controls → Manage third-party app access → Configure new app →
OAuth App Name Or Client ID**, finds Meeting Copilot, and marks it **Trusted**
(optionally scoped to one organizational unit or group, so it applies to your team
only).

Send them, in the request:

- App name: **Meeting Copilot**, an open-source Obsidian plugin
- What it reads: Google Calendar, **read-only** (`calendar.readonly`)
- Where the data goes: nowhere — no backend server exists; everything is processed on
  the user's Mac and stored in their local Obsidian vault
- [Privacy policy](https://meetingcopilot.lobato.vip/privacy.html) ·
  [Source code](https://github.com/alvarolobato/obsidian-meeting-copilot)
- The client ID, if they ask for it: read it from the consent-screen URL
  (`client_id=…apps.googleusercontent.com`) when you attempt to sign in

### B2 — build an internal app inside your organization

If your admin won't allowlist an external app but will let you create a Google Cloud
project inside the company's organization, an **Internal** OAuth client sidesteps the
problem entirely: an internal app belongs to your organization, so it isn't a
third-party app at all.

Follow [Option A](#option-a--your-own-google-cloud-project) with three changes:

1. **Create the project inside the company organization**, not under "No
   organization" — pick your company domain in the *Location* field of the
   project-create dialog. If that field is greyed out or the domain isn't offered, you
   don't have permission to create projects there and you'll need your admin to create
   the project (or to grant you the *Project Creator* role on the org).
2. **Audience → Internal.** This option only appears for Workspace accounts, and
   only when the project lives in the organization.
3. **Skip step 7 entirely.** Internal apps need no publishing and no verification: no
   warning screen, no 100-user cap, and no 7-day token expiry.

What you get for free with an internal app: the directory and group lookups are
running against your own domain with your own admin's blessing, which is exactly the
setup those features were designed for.

Two things that can still bite you:

- The client only works for accounts on your domain. A personal Gmail account cannot
  sign in to it.
- Some organizations also restrict *internal* apps (Admin console → API controls →
  **Internal apps** trust setting). If sign-in is still blocked after all of this, that
  setting is why — and only an admin can change it.

---

## Where your credentials are stored

The client secret and the OAuth tokens are written to Obsidian's **per-vault local
storage on that device** — never to the synced `data.json`, so they don't travel to
your other machines or into a git-backed vault. Setting up a second machine means
pasting the credentials again there.

To revoke access at any time, use
[Google Account → Third-party apps](https://myaccount.google.com/permissions), or
delete the client in the Cloud Console.

---

## Troubleshooting

| What you see | What it means |
| --- | --- |
| *Google hasn't verified this app* | Expected for your own **External** app. **Advanced → Go to … (unsafe)**. An Internal Workspace app never shows it. |
| *Access blocked: your administrator has restricted access to this app* | Your Workspace hasn't approved the app for its users → [Option B](#option-b--your-organization-wont-approve-the-built-in-app). |
| `Error 400: redirect_uri_mismatch` | The OAuth client isn't of type **Desktop app**. Create a new Desktop client. |
| `Error 403: access_denied` right after choosing your account | An **External** app in *Testing* with your account missing from **Test users** — or an admin policy blocks it. |
| `Error 400: invalid_scope`, or the consent screen doesn't list a permission you enabled | That scope isn't added under **Data access** on your consent screen. |
| Reconnect prompt roughly once a week (`invalid_grant`) | An **External** app in *Testing* expires refresh tokens after 7 days → **Audience → Publish app**. |
| `SERVICE_DISABLED` in the console log | The Cloud Identity API or People API isn't enabled on the project (step 2). |
| `people lookup blocked by Workspace admin policy` | Your Workspace disables directory sharing with third-party apps ([this setting](https://support.google.com/a/answer/6343701)). It only blocks `directory.readonly`; the "Other contacts" source still works. |
| You turned an optional permission on but names/groups didn't change | Existing tokens only carry the scopes granted at the last consent — click **Re-authenticate**. |
| Names resolve but group invitees don't expand fully | Expansion is capped by **Max group members to expand** (default 50) in settings. |

Lookups are cached on disk in the plugin folder (`directory-cache.json`; people ~1
year, groups ~1 week), so a fix won't necessarily show up on a previously-failed
attendee until the cache entry expires. **Re-authenticate** clears the negative
entries, which is usually enough.

---

## See also

- [Setup](setup.md) — the rest of the plugin's configuration
- [Privacy policy](privacy-policy.md) — what the plugin does with Google data
- [Google OAuth verification pack](google-verification.md) — how *our* published app
  is verified (maintainer-facing)
