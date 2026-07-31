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
custom domain you own is required for verification.

1. **Enable Pages via Actions.** Repo → **Settings → Pages → Build and deployment →
   Source: GitHub Actions**. The workflow at
   [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) publishes this
   `website/` folder on every push to `main`.
2. **Add the custom domain.** In **Settings → Pages → Custom domain**, enter your
   domain (e.g. `meetingcopilot.app`). GitHub commits a `CNAME` file for you — do not
   hand-create one here with a placeholder, as a wrong value misroutes Pages.
3. **DNS at your registrar:**
   - Apex domain → four `A` records to GitHub Pages
     (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`)
     and/or a `AAAA`/`ALIAS`; **or** a subdomain (`www`) → `CNAME` to
     `<user>.github.io`. See GitHub's Pages custom-domain docs for the current values.
   - Later, add the Google **Search Console** `TXT` record to verify domain ownership.
4. **Enforce HTTPS** in Settings → Pages once the certificate is issued.

## What the verification submission points at

- App home page: `https://<DOMAIN>/`
- Privacy policy: `https://<DOMAIN>/privacy.html`
- Logo: [`assets/logo.svg`](./assets/logo.svg) — export a square PNG (≥120×120) for
  the OAuth consent screen.

See [`docs/google-verification.md`](../docs/google-verification.md) for the full
submission pack.
