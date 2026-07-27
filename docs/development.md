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

Push a semver tag (no `v` prefix):

```bash
git tag -a 0.5.1 -m "0.5.1"
git push origin 0.5.1
```

[`.github/workflows/release.yml`](../.github/workflows/release.yml) builds, signs, pins checksums, and publishes `main.js`, `manifest.json`, `styles.css`, `system-recorder`, `whisper`, and `fvad.wasm`.

## Debugging notifications

Off by default. In the DevTools console (`Cmd+Opt+I`):

```js
localStorage.setItem("mc:notif-debug", "1")
```

Reload the plugin. You'll get `[mc:notif] …` traces and a **Debug test meeting notification** command. To turn off:

```js
localStorage.removeItem("mc:notif-debug")
```

then reload again.
