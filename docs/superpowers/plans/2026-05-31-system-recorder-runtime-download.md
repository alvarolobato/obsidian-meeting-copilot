# System-recorder Runtime Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On first record, fetch the version-matched `system-recorder` binary from the GitHub release, verify it by SHA-256, make it executable, and run it — so Obsidian community-store users (who only receive `main.js`/`manifest.json`/`styles.css`) can actually record.

**Architecture:** A pure, fully-tested `BinaryProvisioner` (`src/binary.ts`) owns "return a path to a verified runnable binary" via injected I/O dependencies. Obsidian-coupled adapters (`src/binary-runtime.ts`) supply the real `fs`/`crypto`/`requestUrl` implementations and resolve the plugin path. `Recorder` is reduced to running a given path; `main.ts` provisions before recording. Provisioning is lazy (first record) and arm64-only.

**Tech Stack:** TypeScript, esbuild, Obsidian API (`requestUrl`, `Platform`), Node `fs/promises`/`crypto`, vitest (new), typescript-eslint flat config.

---

## File Structure

| File | Responsibility | Tested? |
|---|---|---|
| `src/binary.ts` (new) | Pure provisioning logic: `BinaryProvisioner`, `ProvisionerDeps`, `releaseUrl`, `EXPECTED_SHA256`. No Obsidian/Node-runtime imports. | Yes (unit) |
| `src/binary-runtime.ts` (new) | Obsidian/Node adapters: `nodeDeps()` (fs/crypto/`requestUrl`), `resolveBinaryPath(plugin)`. Thin glue. | No |
| `src/binary.test.ts` (new) | Unit tests for `BinaryProvisioner` with fake deps. | — |
| `src/recorder.ts` (modify) | Run a given binary path. Drop path resolution + macOS gate. | No |
| `src/main.ts` (modify) | Gate on macOS, provision binary, then start recorder. | No |
| `vitest.config.ts` (new) | Restrict vitest to `src/**/*.test.ts`, node env. | — |
| `eslint.config.mts` (modify) | Add `globals.node`; ignore `vitest.config.ts`. | — |
| `package.json` (modify) | Add `vitest` devDep + `test` script; bump to 1.0.2. | — |
| `manifest.json`, `versions.json` (modify) | Bump to 1.0.2. | — |
| `README.md` (modify) | Document the release process incl. SHA-256 step. | — |

---

## Task 1: Add the vitest test framework and eslint/globals setup

**Files:**
- Modify: `package.json` (scripts + devDependencies)
- Create: `vitest.config.ts`
- Modify: `eslint.config.mts`

- [ ] **Step 1: Install vitest**

Run: `npm install --save-dev vitest`
Expected: `vitest` added under devDependencies; exits 0.

- [ ] **Step 2: Add the `test` script to package.json**

In `package.json`, inside `"scripts"`, add a `test` entry after `"lint"`:

```json
		"lint": "eslint .",
		"test": "vitest run"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
});
```

- [ ] **Step 4: Update `eslint.config.mts` — add node globals and ignore the vitest config**

Change the `globals` block to merge node globals:

```typescript
			globals: {
				...globals.browser,
				...globals.node,
			},
```

And add `"vitest.config.ts"` to the `globalIgnores([...])` array:

```typescript
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"vitest.config.ts",
	]),
```

- [ ] **Step 5: Verify lint still passes on the existing tree**

Run: `npm run lint`
Expected: no errors (exits 0).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts eslint.config.mts
git commit -m "build: add vitest, node eslint globals"
```

---

## Task 2: Pure `BinaryProvisioner` core (TDD)

**Files:**
- Create: `src/binary.ts`
- Test: `src/binary.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/binary.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { BinaryProvisioner, ProvisionerDeps, releaseUrl } from "./binary";

const VALID = "validhash";
const BIN = "/plugin/system-recorder";
const VERSION = "1.0.2";

function makeDeps(overrides: Partial<ProvisionerDeps> = {}): ProvisionerDeps {
	return {
		arch: () => "arm64",
		fileExists: async () => false,
		readFile: async () => Buffer.from("existing"),
		writeFile: async () => undefined,
		chmod: async () => undefined,
		rename: async () => undefined,
		download: async () => Buffer.from("downloaded"),
		sha256: () => VALID,
		...overrides,
	};
}

describe("BinaryProvisioner", () => {
	it("returns the path without downloading when the existing hash matches", async () => {
		const download = vi.fn(async () => Buffer.from("x"));
		const deps = makeDeps({ fileExists: async () => true, sha256: () => VALID, download });
		await expect(new BinaryProvisioner(deps, VALID).ensure(BIN, VERSION)).resolves.toBe(BIN);
		expect(download).not.toHaveBeenCalled();
	});

	it("downloads, verifies, chmods, and renames when the binary is missing", async () => {
		const calls: string[] = [];
		const deps = makeDeps({
			fileExists: async () => false,
			download: async (url) => { calls.push(`download:${url}`); return Buffer.from("bin"); },
			sha256: () => VALID,
			writeFile: async (p) => { calls.push(`write:${p}`); },
			chmod: async (p, m) => { calls.push(`chmod:${p}:${m}`); },
			rename: async (from, to) => { calls.push(`rename:${from}->${to}`); },
		});
		await expect(new BinaryProvisioner(deps, VALID).ensure(BIN, VERSION)).resolves.toBe(BIN);
		expect(calls).toEqual([
			`download:${releaseUrl(VERSION)}`,
			`write:${BIN}.tmp`,
			`chmod:${BIN}.tmp:${0o755}`,
			`rename:${BIN}.tmp->${BIN}`,
		]);
	});

	it("re-downloads when the existing binary hash does not match", async () => {
		const download = vi.fn(async () => Buffer.from("new"));
		let n = 0;
		const deps = makeDeps({
			fileExists: async () => true,
			sha256: () => (n++ === 0 ? "old" : VALID),
			download,
		});
		await expect(new BinaryProvisioner(deps, VALID).ensure(BIN, VERSION)).resolves.toBe(BIN);
		expect(download).toHaveBeenCalledOnce();
	});

	it("throws and does not install when the download fails verification", async () => {
		const writeFile = vi.fn(async () => undefined);
		const chmod = vi.fn(async () => undefined);
		const rename = vi.fn(async () => undefined);
		const deps = makeDeps({ fileExists: async () => false, sha256: () => "wrong", writeFile, chmod, rename });
		await expect(new BinaryProvisioner(deps, VALID).ensure(BIN, VERSION)).rejects.toThrow("failed verification");
		expect(writeFile).not.toHaveBeenCalled();
		expect(chmod).not.toHaveBeenCalled();
		expect(rename).not.toHaveBeenCalled();
	});

	it("throws on non-arm64 before any fs or network access", async () => {
		const fileExists = vi.fn(async () => true);
		const download = vi.fn(async () => Buffer.from("x"));
		const deps = makeDeps({ arch: () => "x64", fileExists, download });
		await expect(new BinaryProvisioner(deps, VALID).ensure(BIN, VERSION)).rejects.toThrow("Apple Silicon");
		expect(fileExists).not.toHaveBeenCalled();
		expect(download).not.toHaveBeenCalled();
	});

	it("wraps download errors with a friendly message", async () => {
		const deps = makeDeps({
			fileExists: async () => false,
			download: async () => { throw new Error("HTTP 404"); },
		});
		await expect(new BinaryProvisioner(deps, VALID).ensure(BIN, VERSION))
			.rejects.toThrow("Failed to download the recorder helper: HTTP 404");
	});

	it("invokes onDownloadStart only when a download occurs", async () => {
		const cb = vi.fn();
		await new BinaryProvisioner(makeDeps({ fileExists: async () => true, sha256: () => VALID }), VALID)
			.ensure(BIN, VERSION, cb);
		expect(cb).not.toHaveBeenCalled();
		await new BinaryProvisioner(makeDeps({ fileExists: async () => false, sha256: () => VALID }), VALID)
			.ensure(BIN, VERSION, cb);
		expect(cb).toHaveBeenCalledOnce();
	});

	it("dedupes concurrent ensure calls into a single download", async () => {
		let downloads = 0;
		const deps = makeDeps({
			fileExists: async () => false,
			download: async () => { downloads++; await new Promise((r) => setTimeout(r, 5)); return Buffer.from("x"); },
			sha256: () => VALID,
		});
		const p = new BinaryProvisioner(deps, VALID);
		await Promise.all([p.ensure(BIN, VERSION), p.ensure(BIN, VERSION)]);
		expect(downloads).toBe(1);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./binary` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/binary.ts`:

```typescript
export const EXPECTED_SHA256 =
	"8a5326ea84eff8f8a3221e8584b86a2515680f6e575b7cc3e6301fa949560cf2";

const REPO = "yut0takagi/obsidian-system-recording";

export function releaseUrl(version: string): string {
	return `https://github.com/${REPO}/releases/download/${version}/system-recorder`;
}

export interface ProvisionerDeps {
	arch: () => string;
	fileExists: (path: string) => Promise<boolean>;
	readFile: (path: string) => Promise<Buffer>;
	writeFile: (path: string, data: Buffer) => Promise<void>;
	chmod: (path: string, mode: number) => Promise<void>;
	rename: (from: string, to: string) => Promise<void>;
	download: (url: string) => Promise<Buffer>;
	sha256: (data: Buffer) => string;
}

export class BinaryProvisioner {
	private inflight: Promise<string> | null = null;

	constructor(
		private readonly deps: ProvisionerDeps,
		private readonly expectedSha: string = EXPECTED_SHA256
	) {}

	ensure(
		binaryPath: string,
		version: string,
		onDownloadStart?: () => void
	): Promise<string> {
		if (!this.inflight) {
			this.inflight = this.provision(binaryPath, version, onDownloadStart).finally(
				() => {
					this.inflight = null;
				}
			);
		}
		return this.inflight;
	}

	private async provision(
		binaryPath: string,
		version: string,
		onDownloadStart?: () => void
	): Promise<string> {
		if (this.deps.arch() !== "arm64") {
			throw new Error("System Recording requires Apple Silicon (arm64).");
		}

		if (await this.deps.fileExists(binaryPath)) {
			const existing = await this.deps.readFile(binaryPath);
			if (this.deps.sha256(existing) === this.expectedSha) {
				return binaryPath;
			}
		}

		onDownloadStart?.();

		let bytes: Buffer;
		try {
			bytes = await this.deps.download(releaseUrl(version));
		} catch (e) {
			throw new Error(
				`Failed to download the recorder helper: ${(e as Error).message}`
			);
		}

		if (this.deps.sha256(bytes) !== this.expectedSha) {
			throw new Error("Recorder helper failed verification.");
		}

		const tmp = `${binaryPath}.tmp`;
		await this.deps.writeFile(tmp, bytes);
		await this.deps.chmod(tmp, 0o755);
		await this.deps.rename(tmp, binaryPath);
		return binaryPath;
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 8 tests green.

- [ ] **Step 5: Lint the new files**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/binary.ts src/binary.test.ts
git commit -m "feat: add BinaryProvisioner with SHA-256 verification (tested)"
```

---

## Task 3: Obsidian/Node adapters (`binary-runtime.ts`)

**Files:**
- Create: `src/binary-runtime.ts`

- [ ] **Step 1: Create `src/binary-runtime.ts`**

```typescript
import { requestUrl, type Plugin } from "obsidian";
import * as fsp from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { ProvisionerDeps } from "./binary";

export function nodeDeps(): ProvisionerDeps {
	return {
		arch: () => process.arch,
		fileExists: async (p) => {
			try {
				await fsp.access(p);
				return true;
			} catch {
				return false;
			}
		},
		readFile: (p) => fsp.readFile(p),
		writeFile: (p, data) => fsp.writeFile(p, data),
		chmod: (p, mode) => fsp.chmod(p, mode),
		rename: (from, to) => fsp.rename(from, to),
		download: async (url) => {
			const res = await requestUrl({ url, method: "GET", throw: false });
			if (res.status !== 200) {
				throw new Error(`HTTP ${res.status}`);
			}
			return Buffer.from(res.arrayBuffer);
		},
		sha256: (data) => crypto.createHash("sha256").update(data).digest("hex"),
	};
}

export function resolveBinaryPath(plugin: Plugin): string {
	// FileSystemAdapter exposes getBasePath() but it is not in the public type
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
	const basePath = (plugin.app.vault.adapter as any).getBasePath() as string;
	return path.join(basePath, plugin.manifest.dir ?? "", "system-recorder");
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run build && npm run lint`
Expected: build emits `main.js`, lint clean. (esbuild externalizes node builtins; this file is only reached via `main.ts` later.)

- [ ] **Step 3: Commit**

```bash
git add src/binary-runtime.ts
git commit -m "feat: add node/obsidian provisioner deps and path resolver"
```

---

## Task 4: Reduce `Recorder` to running a given binary path

**Files:**
- Modify: `src/recorder.ts`

- [ ] **Step 1: Replace the imports — drop `Plugin`/`Platform`**

Replace the top import block:

```typescript
import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
```

(Remove the `import { Plugin, Platform } from "obsidian";` line entirely.)

- [ ] **Step 2: Delete `getBinaryPath` and change `start` to take the path**

Remove the entire `private getBinaryPath(...) { ... }` method. Replace the start of `start(...)` — from its signature through the `spawn(...)` call — with:

```typescript
	start(binaryPath: string, outputPath: string): void {
		if (this._isRecording) return;

		const stopFile = path.join(
			os.tmpdir(),
			`system-recorder-stop-${Date.now()}`
		);
		this.stopFilePath = stopFile;

		const proc = spawn(binaryPath, [
			"start", "--output", outputPath,
			"--stop-file", stopFile,
		], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.process = proc;
		this._isRecording = true;
```

Leave everything after `this._isRecording = true;` (the `buffer`, stdout/stderr/close/error handlers) and the `stop()` method unchanged.

- [ ] **Step 3: Build and lint**

Run: `npm run build && npm run lint`
Expected: build fails in `main.ts` (it still calls `recorder.start(this, absolutePath)` — fixed in Task 5). `recorder.ts` itself must compile clean. If the only error is in `main.ts`, proceed to Task 5. Lint of `recorder.ts` clean.

> Note: This task and Task 5 are committed together at the end of Task 5, because `main.ts` and `recorder.ts` must change in lockstep to build.

---

## Task 5: Provision the binary before recording in `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update imports**

Replace:

```typescript
import { MarkdownView, Notice, Plugin } from "obsidian";
```

with:

```typescript
import { MarkdownView, Notice, Platform, Plugin } from "obsidian";
```

And add, after the existing `import { Recorder, RecorderStatus } from "./recorder";` line:

```typescript
import { BinaryProvisioner } from "./binary";
import { nodeDeps, resolveBinaryPath } from "./binary-runtime";
```

- [ ] **Step 2: Add a provisioner field**

After the line `private recorder = new Recorder();` add:

```typescript
	private provisioner = new BinaryProvisioner(nodeDeps());
```

- [ ] **Step 3: Replace `startRecording` with the provisioning flow**

Replace the entire `private async startRecording() { ... }` method with:

```typescript
	private async startRecording() {
		if (this.recorder.isRecording) {
			new Notice("Already recording");
			return;
		}

		if (!Platform.isMacOS) {
			new Notice("System recording is only supported on macOS");
			return;
		}

		// Ensure the recorder helper binary is present and verified
		let binaryPath: string;
		try {
			binaryPath = await this.provisioner.ensure(
				resolveBinaryPath(this),
				this.manifest.version,
				() => new Notice("Downloading recorder helper…")
			);
		} catch (e) {
			new Notice((e as Error).message);
			return;
		}

		// Ensure recording folder exists
		const folder = this.settings.recordingFolder;
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(folder))) {
			await adapter.mkdir(folder);
		}

		// Generate file name
		const fileName = this.formatFileName(this.settings.fileNameTemplate);
		const relativePath = `${folder}/${fileName}.wav`;
		// Obsidian's FileSystemAdapter has getBasePath() but it's not in the public type
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		const vaultBasePath = (adapter as any).getBasePath() as string;
		const absolutePath = path.join(vaultBasePath, relativePath);

		// Start recording
		this.recorder.start(binaryPath, absolutePath);
		this.recordingStartTime = Date.now();
		this.startDurationTimer();
		this.updateRibbonIcon(true);

		new Notice("Recording started");
	}
```

- [ ] **Step 4: Build, lint, and test**

Run: `npm run build && npm run lint && npm test`
Expected: build emits `main.js`; lint clean; 8 tests pass.

- [ ] **Step 5: Commit (Tasks 4 + 5 together)**

```bash
git add src/recorder.ts src/main.ts
git commit -m "feat: provision and verify system-recorder binary before recording"
```

---

## Task 6: Manual verification in a real vault (checkpoint)

**Files:** none (manual)

- [ ] **Step 1: Deploy the build to the test vault**

Copy `main.js`, `manifest.json`, `styles.css` into the vault's plugin folder, and **delete** any existing `system-recorder` there to simulate a store install:

```bash
PLUGIN_DIR="/Users/s32747/vault/.obsidian/plugins/system-recording"
mkdir -p "$PLUGIN_DIR"
cp main.js manifest.json styles.css "$PLUGIN_DIR"/
rm -f "$PLUGIN_DIR/system-recorder"
```

- [ ] **Step 2: Reload the plugin in Obsidian, start a recording**

Expected: a "Downloading recorder helper…" Notice appears once, then "Recording started". A `system-recorder` file appears in `$PLUGIN_DIR` (executable). Stop → a `.wav` is written and linked. Confirm `shasum -a 256 "$PLUGIN_DIR/system-recorder"` equals the `EXPECTED_SHA256` constant.

- [ ] **Step 3: Start a second recording**

Expected: no "Downloading…" Notice (existing binary hash matches → no re-download). Recording starts immediately.

> If verification fails here, STOP and debug before releasing. Do not proceed to Task 7.

---

## Task 7: Document the release process and ship 1.0.2

**Files:**
- Modify: `README.md`
- Modify: `manifest.json`, `versions.json`, `package.json`

- [ ] **Step 1: Bump versions to 1.0.2**

In `manifest.json`: `"version": "1.0.2"`.
In `package.json`: `"version": "1.0.2"`.
In `versions.json`, add the entry:

```json
{
	"1.0.0": "0.15.0",
	"1.0.1": "0.15.0",
	"1.0.2": "0.15.0"
}
```

- [ ] **Step 2: Append a Release section to `README.md`**

Add to `README.md`:

```markdown
## Releasing

The macOS helper (`system-recorder`) is downloaded by the plugin on first use and
verified against `EXPECTED_SHA256` in `src/binary.ts`. The embedded hash and the
released binary asset MUST come from the same build.

1. `npm run build:swift` — builds `swift-helper/.build/release/system-recorder`.
2. `shasum -a 256 swift-helper/.build/release/system-recorder` — copy the hex into
   `EXPECTED_SHA256` in `src/binary.ts`.
3. Copy that binary to the repo root as `system-recorder`.
4. `npm run build` — bundles the updated hash into `main.js`.
5. `npm test && npm run lint` — must pass.
6. Bump `manifest.json` / `versions.json` / `package.json`, commit, tag `X.Y.Z`
   (no `v` prefix), and `gh release create X.Y.Z main.js manifest.json styles.css system-recorder`.
```

- [ ] **Step 3: Confirm the embedded hash matches the binary being shipped**

Run: `shasum -a 256 system-recorder | awk '{print $1}'`
Expected: `8a5326ea84eff8f8a3221e8584b86a2515680f6e575b7cc3e6301fa949560cf2` (equals `EXPECTED_SHA256`). If it differs, update `EXPECTED_SHA256` in `src/binary.ts`, rebuild (`npm run build`), and re-run tests.

- [ ] **Step 4: Final build + checks**

Run: `npm run build && npm run lint && npm test`
Expected: all green.

- [ ] **Step 5: Commit, tag, push, release**

```bash
git add manifest.json versions.json package.json README.md src/binary.ts
git commit -m "release: 1.0.2 — runtime download of system-recorder binary"
git tag 1.0.2
git push origin main
git push origin refs/tags/1.0.2
gh release create 1.0.2 main.js manifest.json styles.css system-recorder \
  --title "1.0.2" \
  --notes "Store-installed users now get the system-recorder helper automatically (downloaded from this release and SHA-256 verified on first record). Apple Silicon only."
```

- [ ] **Step 6: Verify the release matches the manifest**

Run: `gh api repos/yut0takagi/obsidian-system-recording/releases/tags/1.0.2 -q '{tag:.tag_name, draft:.draft, assets:[.assets[].name]}'`
Expected: `tag` = `1.0.2`, `draft` = false, assets include `system-recorder`.

---

## Notes / known tradeoffs (from spec)

- A locally rebuilt Swift binary likely won't match `EXPECTED_SHA256`, so dev installs will
  re-download the released binary. To test a custom local build, temporarily set
  `EXPECTED_SHA256` to the local hash.
- First record requires network (once) to fetch the binary; offline shows a clear Notice and aborts.
- Screen Recording (TCC) permission is still prompted by macOS on first capture — out of scope.
