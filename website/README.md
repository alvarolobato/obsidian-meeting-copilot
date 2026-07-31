# Meeting Copilot website

Static marketing + privacy site published to GitHub Pages. It provides the two pages
Google OAuth verification requires: a public **home page** (`index.html`) and a
**privacy policy** (`privacy.html`). Self-contained — no external fonts, scripts, or
trackers, matching the plugin's privacy stance.

The privacy policy here mirrors the canonical
[`docs/privacy-policy.md`](../docs/privacy-policy.md); keep the two in sync.

## Local preview

Open `index.html` in a browser, or serve the folder:

```bash
cd website && python3 -m http.server 8000   # http://localhost:8000
```

## Deploying to GitHub Pages (custom domain required)

Google **cannot** verify a `*.github.io` URL (`github.io` is a public suffix), so a
custom domain you own is required for verification. The chosen domain is
**`meetingcopilot.lobato.vip`** (a subdomain of `lobato.vip`).

1. **Enable Pages via Actions.** Repo → **Settings → Pages → Build and deployment →
   Source: GitHub Actions**. The workflow at
   [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) publishes this
   `website/` folder on every push to `main`.
2. **Add the custom domain.** In **Settings → Pages → Custom domain**, enter
   `meetingcopilot.lobato.vip`. GitHub commits a `CNAME` file for you — do not
   hand-create one here with a placeholder, as a wrong value misroutes Pages.
3. **DNS at the `lobato.vip` registrar:**
   - Add a `CNAME` record: `meetingcopilot` → `alvarolobato.github.io`
     (subdomains use `CNAME`, not apex `A` records).
   - For Google verification, add `lobato.vip` as a **Domain** property in Search
     Console and complete its DNS `TXT` verification (the OAuth *authorized domain* is
     the top private domain `lobato.vip`, which covers this subdomain).
4. **Enforce HTTPS** in Settings → Pages once the certificate is issued.

## What the verification submission points at

- App home page: `https://meetingcopilot.lobato.vip/`
- Privacy policy: `https://meetingcopilot.lobato.vip/privacy.html`
- Logo: [`assets/logo.svg`](./assets/logo.svg) — export a square PNG (≥120×120) for
  the OAuth consent screen.

See [`docs/google-verification.md`](../docs/google-verification.md) for the full
submission pack.
