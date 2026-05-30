# Design: Runtime download of the system-recorder binary

**Date:** 2026-05-31
**Status:** Approved (brainstorming)
**Target version:** 1.0.2 (or 1.1.0)

## Problem

Obsidian's community store only delivers `main.js`, `manifest.json`, and `styles.css`
from a plugin's GitHub release. The `system-recorder` Swift binary — which performs the
actual ScreenCaptureKit capture — is **not** downloaded. Today `Recorder.getBinaryPath()`
([src/recorder.ts](../../../src/recorder.ts)) expects the binary to already sit inside the
plugin folder, so store-installed users hit `ENOENT` on `spawn` and cannot record. The
plugin only works on machines where the binary was placed manually (i.e. the developer's).

## Goal

When a store-installed user starts a recording, the plugin transparently fetches the
correct `system-recorder` binary from the matching GitHub release, verifies it, makes it
executable, and runs it — with no manual steps.

## Non-goals

- Intel (x86_64) support. arm64-only; non-arm64 fails with a clear message.
- Windows/Linux support (already gated by `Platform.isMacOS`).
- Code-signing / notarization beyond Swift's default ad-hoc signing.
- Eager download at plugin load. Provisioning is lazy (first record).

## Decisions (with alternatives considered)

| Decision | Choice | Why / alternative rejected |
|---|---|---|
| Which binary to fetch | Release matching `manifest.version` | Code and binary always match. (Rejected: "latest" → drift.) |
| Detecting a stale/missing binary | Re-hash the existing file every start | One mechanism handles upgrades (new version → new expected hash → old binary mismatches → re-download) **and** corruption. SHA-256 of 140 KB is negligible. (Rejected: version marker file → more moving parts.) |
| Integrity | SHA-256 verify before execute | Downloading an executable. Expected hash embedded as a source constant, refreshed per release. (Rejected: trust HTTPS only.) |
| Download transport | Obsidian `requestUrl` | Follows GitHub release redirects, bypasses CORS, no new dependency. `fs`-written files get no `com.apple.quarantine`, so the ad-hoc-signed arm64 binary runs. |
| Arch | arm64 only | `process.arch === "arm64"`; otherwise clear Notice + abort. |

## Architecture

New module **`BinaryProvisioner`** (`src/binary.ts`) owns "return a path to a runnable,
verified `system-recorder`." `Recorder` is reduced to "run the binary at the path it's
given." This isolates network/fs/verification concerns from process management and makes
the provisioner unit-testable via injected dependencies.

### Components

**`src/binary.ts` — `BinaryProvisioner`**
- `ensure(plugin): Promise<string>` — returns the verified binary path or throws.
- Pure logic split into injectable deps so tests need no real fs/network:
  `{ arch, fileExists, readFile, writeFile, chmod, rename, download, sha256 }`.
- Constant `EXPECTED_SHA256` (hex) — the released binary's hash for this plugin version.
- Constant builder for the download URL from `manifest.version`.

**`src/recorder.ts` — `Recorder` (modified)**
- Remove `getBinaryPath()`.
- `start(binaryPath: string, outputPath: string)` — takes the resolved path; spawn logic unchanged.

**`src/main.ts` — `startRecording()` (modified)**
- `const binaryPath = await provisioner.ensure(this)` before `recorder.start(binaryPath, absolutePath)`.
- Wrap in try/catch → on failure show the provisioner's message and do **not** start.

### Data flow (record start)

```
startRecording()
  ├─ await provisioner.ensure(plugin)
  │    1. arch !== "arm64"                  → throw "Requires Apple Silicon (arm64)."
  │    2. path = <basePath>/<manifest.dir>/system-recorder
  │    3. exists(path) && sha256(file) === EXPECTED_SHA256  → return path        (no network)
  │    4. else: requestUrl(releaseUrl(manifest.version)) → bytes
  │             sha256(bytes) !== EXPECTED_SHA256 → throw "Checksum mismatch."
  │             write <path>.tmp → chmod 0o755 → rename to <path>
  │    5. return path
  ├─ recorder.start(binaryPath, absolutePath)
  └─ (catch) Notice(message); abort
```

Download URL: `https://github.com/yut0takagi/obsidian-system-recording/releases/download/<manifest.version>/system-recorder`

### Error handling

All failures surface a Notice and abort the recording start (never spawn a missing/invalid binary):
- Non-arm64 → "System Recording requires Apple Silicon (arm64)."
- Download failure (offline, 404, network) → "Failed to download the recorder helper: <reason>"
- Checksum mismatch (download or existing file's re-download also mismatches) → "Recorder helper failed verification."

A "Downloading recorder helper…" Notice is shown when a download starts, so first-run latency is explained.

### Concurrency

`ensure()` guards against overlapping downloads with an in-flight `Promise` cached on the
provisioner; a second `startRecording` during download awaits the same promise.

## Testing (TDD)

The repo currently has **no test framework** (no `test` script in `package.json`). The
implementation plan must add a lightweight one first — proposed: `vitest` (TS-native, zero
config with the existing esbuild/TS setup) with a `npm test` script. Tests live in
`src/binary.test.ts`. Because all I/O is injected, no real fs/network/binary is touched.

`BinaryProvisioner.ensure` with injected deps:
1. Existing file, hash matches → no `download` call; returns path.
2. File missing → `download` → hash ok → `writeFile` + `chmod 0o755` + `rename` → returns path.
3. Existing file, hash mismatch → triggers `download` (upgrade path).
4. Download bytes hash mismatch → throws; no `chmod`, no `rename`, no run.
5. `arch !== "arm64"` → throws before any fs/network.
6. Concurrent `ensure()` calls → single `download`.

## Release process (new, documented in README)

1. `npm run build:swift` → produces `swift-helper/.build/release/system-recorder`.
2. Compute `shasum -a 256 <binary>`; paste hex into `EXPECTED_SHA256` in `src/binary.ts`.
3. `npm run build` (bundles the new constant into main.js).
4. Copy binary to repo root as `system-recorder`.
5. Tag + `gh release create <version> main.js manifest.json styles.css system-recorder`.

The embedded hash and the released asset must come from the **same** build.

## Tradeoffs / known limitations

- **Dev rebuilds re-download.** A locally rebuilt Swift binary is unlikely to be byte-identical
  to the released one, so its hash won't match `EXPECTED_SHA256` and the provisioner will fetch
  the released binary. Accepted: the developer ends up running the canonical released binary.
  To test a custom local build, temporarily update `EXPECTED_SHA256` to the local hash.
- **First record needs network.** If offline on first use (or after an update), recording is
  blocked with a clear message until the binary is fetched once.
- **Screen Recording permission (TCC)** is still required and prompted by macOS on first capture;
  out of scope for this change.

## Affected files

- New: `src/binary.ts`, `src/binary.test.ts` (or chosen test path)
- Modified: `src/recorder.ts`, `src/main.ts`
- Docs: `README.md` (release process + hash step)
