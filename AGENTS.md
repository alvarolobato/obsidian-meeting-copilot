# AGENTS.md

Working notes for AI agents (and humans) contributing to **Meeting Copilot**, an
Obsidian plugin that brings Granola-style meeting capture to Obsidian: Google
Calendar sync, dual-channel recording via a macOS Swift helper, transcription
(vendored engine, OpenAI-compatible / LiteLLM endpoints), and LLM enrichment.

Repo: `alvarolobato/obsidian-meeting-copilot`. Platform: macOS only (the
recorder helper uses ScreenCaptureKit / Core Audio).

## Repository layout

- `src/` — plugin TypeScript. Entry point `src/main.ts`.
  - `src/calendar/` — Google Calendar API + OAuth (`googleOAuth.ts`), scheduler.
  - `src/notes/` — meeting-note creation, folder resolution, transcript/enriched blocks, dashboard.
  - `src/transcribe/` — transcription orchestrator + **vendored** engine under `src/transcribe/vendor/` (see below).
  - `src/enrich/` — enrichment prompts.
  - `src/detect/` — meeting detection (Zoom/Meet probes).
  - `src/ui/` — agenda sidebar view and modals.
  - `src/i18n/` — localization; **English is the base language** (`en.ts`). UI strings go through `t()`.
- `swift-helper/` — the `SystemRecorder` Swift package (dual-channel audio capture). Built into the `system-recorder` binary shipped with the plugin.
- `.github/workflows/` — `ci.yml` (PRs + pushes to main) and `release.yml` (version tags).
- `manifest.json`, `versions.json`, `styles.css`, `esbuild.config.mjs`.

## Prerequisites

- Node.js (use the version pinned in CI; `actions/setup-node@v5`).
- Xcode / Swift toolchain (for the recorder helper, macOS only).
- `npm install` (or `npm ci`) once per worktree.

## Build, test, lint

```bash
npm run build        # tsc -noEmit typecheck + esbuild production bundle -> main.js
npm run build:swift  # swift build -c release -> swift-helper/.build/release/SystemRecorder
npm run build:all    # swift then JS
npm run lint         # eslint .
npm test             # vitest run
```

**Before opening or updating a PR, all of these must pass:** `npm run lint`,
`npm test`, `npm run build`. If the change touches `swift-helper/`, also run
`npm run build:swift` (CI builds it on a macOS runner).

There is no separate `typecheck` script — `npm run build` runs `tsc -noEmit`
first, so a clean build is the typecheck.

## Branch / worktree workflow

Use **one git worktree per branch/PR** so multiple efforts don't clash and the
main checkout stays on `main`. Worktrees live as sibling folders of the main
repo (e.g. `../mc-<topic>`).

```bash
git fetch origin
git worktree add -b fix/my-thing ../mc-my-thing origin/main
cd ../mc-my-thing && npm ci
# ...work, commit, push...
```

Clean up merged worktrees:

```bash
git worktree remove ../mc-my-thing
git worktree prune
git branch -d fix/my-thing   # after the PR merges
```

## Pull request & review process

1. Branch off the latest `origin/main` in a fresh worktree.
2. Implement, keeping changes focused. Add/adjust `vitest` tests for logic changes.
3. Ensure lint + tests + build are green.
4. Open a PR with a Summary + Test plan (use a HEREDOC for the body).
5. **Review cycles** (this is the norm for non-trivial PRs):
   - **Copilot** review (`gh` auto-review) — a first pass.
   - An **independent Opus review** — a second, deeper pass.
   - Address every finding; push fixes as new commits (don't force-push unless asked).
6. Re-run reviews until clean, then merge (squash) once CI is green.

Only merge when the user asks. Never create commits or push unless requested.

### Reading PR feedback with `gh`

```bash
gh pr view <n> --json title,state,mergeable,mergeStateStatus,body
gh api repos/alvarolobato/obsidian-meeting-copilot/pulls/<n>/comments
gh api repos/alvarolobato/obsidian-meeting-copilot/pulls/<n>/reviews
```

## Resolving conflicts / updating a branch with main

- Prefer `git merge origin/main` into the branch over `git rebase` when a rebase
  produces **cascading conflicts** (each replayed commit re-conflicting in the
  same region). A single merge resolution is usually far cleaner and reaches the
  same up-to-date state. Rebase is fine when it's clean.
- After resolving, always re-run lint + tests + build before pushing.

## Local deploy to the Obsidian vault (for manual testing)

Dev vault plugin dir: `<vault>/.obsidian/plugins/meeting-copilot/`
(current dev vault: `/Users/alobato/git/notes/.obsidian/plugins/meeting-copilot/`).

The plugin verifies the `system-recorder` binary against `EXPECTED_SHA256` in
`src/binary.ts` (refreshed per release from the CI-built binary). A dev build
won't match the binary sitting in your vault, so pin the sha for the deploy,
then revert it so the worktree stays clean.

**Never overwrite `data.json`** in the vault — it holds the user's settings.
(OAuth tokens + client secret live in per-vault Obsidian localStorage, not
`data.json`.)

### Case A — JS/CSS-only change (recorder helper unchanged)

Keep the existing vault binary; pin the build to *its* sha.

```bash
DEST="/Users/alobato/git/notes/.obsidian/plugins/meeting-copilot"
VAULT_SHA=$(shasum -a 256 "$DEST/system-recorder" | cut -d' ' -f1)
# pin: replace the current EXPECTED_SHA256 value in src/binary.ts with $VAULT_SHA
npm run build
cp main.js manifest.json styles.css "$DEST/"   # NOT data.json, NOT the binary
git checkout src/binary.ts                       # revert the pin
```

### Case B — `swift-helper/` changed (new binary needed)

Build the helper, stage it as `system-recorder`, pin *its* sha, build JS, deploy
the binary too.

```bash
DEST="/Users/alobato/git/notes/.obsidian/plugins/meeting-copilot"
npm run build:swift
cp swift-helper/.build/release/SystemRecorder system-recorder && chmod +x system-recorder
SHA=$(shasum -a 256 system-recorder | cut -d' ' -f1)
# pin: replace EXPECTED_SHA256 in src/binary.ts with $SHA
npm run build
cp main.js manifest.json styles.css system-recorder "$DEST/" && chmod +x "$DEST/system-recorder"
git checkout src/binary.ts    # revert the pin
rm -f system-recorder         # don't leave the staged binary in the worktree
```

After deploying: **reload the plugin** in Obsidian (toggle off/on, or restart).

**Screen Recording permission (macOS/TCC):** replacing the `system-recorder`
binary changes its code hash, so macOS may treat it as new and require
re-granting permission. If recording starts then immediately stops with a
permission error, re-approve Obsidian under System Settings → Privacy &
Security → Screen Recording and restart Obsidian.

## Releases

Releases are cut by pushing a semver tag; `release.yml` builds everything on a
macOS runner, pins the freshly built binary's sha into the bundle, and publishes
a GitHub Release with `main.js`, `manifest.json`, `styles.css`, and
`system-recorder`.

```bash
git tag -a 0.2.0 -m "0.2.0"
git push origin 0.2.0
```

`release.yml` also syncs `manifest.json` / `package.json` / `versions.json` to
the tag. `ci.yml` runs typecheck/lint/test/build on PRs and pushes to `main`,
plus a macOS job that builds the Swift helper. Keep GitHub Action versions
current (e.g. `actions/checkout@v5`, `actions/setup-node@v5`).

## Conventions & gotchas

- **Secrets:** Google OAuth tokens and the client secret are stored in per-vault
  Obsidian localStorage (`app.loadLocalStorage`/`saveLocalStorage`, requires
  `minAppVersion` ≥ 1.8.7), never in the synced/committed `data.json`.
  `saveSettings` strips them from `data.json` only after a *verified*
  localStorage write.
- **Vendored transcriber (`src/transcribe/vendor/`):** keep vendored files as
  pristine as possible for easy upstream updates. Our config/endpoint glue lives
  in `src/transcribe/TranscriptionService.ts` + `endpointConfig.ts`; the base
  URL / model overrides are injected via a small seam, not by rewriting vendored
  code. See `src/transcribe/vendor/VENDOR.md`.
- **i18n:** English is the base. Add UI strings to `src/i18n/en.ts` and use
  `t()`; don't hardcode user-facing strings.
- **Retention safety:** audio is pruned only when the owning note has the
  managed `transcript_saved` frontmatter flag (set by `insertTranscript`), never
  by sniffing the note body — a template placeholder must not cause data loss.
- **Tests:** logic lives in pure, testable functions where possible; the
  `obsidian` module is mocked in `test/obsidian-mock.ts`, and note/vault logic
  uses in-memory fakes. Add tests alongside behavior changes.
- **Commits:** small, focused, with a clear "why". Don't commit `.env` /
  credentials. Only commit/push when the user asks.
