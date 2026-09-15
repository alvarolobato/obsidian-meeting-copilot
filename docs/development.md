# Development

```bash
npm install
npm run build:all   # Swift helper + JS
npm run dev         # watch build
npm test && npm run lint
npm run deploy:local          # JS/CSS → vault
npm run deploy:local -- --swift  # also rebuild helper + whisper dylib
```

See [`AGENTS.md`](../AGENTS.md) for worktrees, PR review flow, and deploy gotchas.

## macOS helper (`system-recorder`)

The plugin downloads `system-recorder` from the GitHub release matching `manifest.json` `version`, verified against `EXPECTED_SHA256` in [`src/binary.ts`](../src/binary.ts). The helper links whisper.cpp dynamically, so `whisper` is a second asset (`EXPECTED_WHISPER_SHA256` / `WHISPER_DYLIB_SIZE`), placed at `whisper.framework/Versions/Current/whisper`. Local Whisper **models** are separate on-demand downloads ([`src/transcribe/localModels.ts`](../src/transcribe/localModels.ts)).

## Releasing

From an up-to-date, clean `main`:

```bash
npm version 0.5.1 -m "chore: release %s"
git push origin 0.5.1   # starts release.yml, which builds from the tag
# after the release succeeds:
git push origin main
```

`npm version` writes the version into `package.json`, `manifest.json`, and `versions.json` (via [`scripts/sync-release-version.mjs`](../scripts/sync-release-version.mjs)), commits, and creates the tag (no `v` prefix). The tagged commit already holds the release version, so the published `manifest.json` matches the repository's, which the community directory checks.

Push the tag before `main`: Obsidian and the community directory read `manifest.json` from `main`, so `main` should only show a version once its release exists. If the release fails, `main` is untouched. Delete the tag (`git tag -d 0.5.1 && git push origin :refs/tags/0.5.1`), drop the release commit (`git reset --hard origin/main`), land the fix on `main`, and run `npm version` again. Older tags (0.9.2 and earlier) can't be re-run from the Actions tab: their tagged commits hold the previous version, so the check refuses them.

[`.github/workflows/release.yml`](../.github/workflows/release.yml) first checks that the tag matches those files ([`scripts/check-release-version.mjs`](../scripts/check-release-version.mjs)), then builds, signs, pins checksums, and publishes `main.js`, `manifest.json`, `styles.css`, `system-recorder`, `whisper`, and `fvad.wasm`. Every asset gets a signed build-provenance attestation; check one with `gh attestation verify <file> -R alvarolobato/obsidian-meeting-copilot`. `src/binary.ts` checksum placeholders remain on `main` — only release artifacts pin the real helper/dylib shas.

## Debugging notifications

Local and custom builds only: release builds ignore the flag, so shipped code never reads `localStorage` directly. Off by default. In the DevTools console (`Cmd+Opt+I`):

```js
localStorage.setItem("mc:notif-debug", "1")
```

Reload the plugin. You'll get `[mc:notif] …` traces and a **Debug test meeting notification** command. To turn off:

```js
localStorage.removeItem("mc:notif-debug")
```

then reload again.
