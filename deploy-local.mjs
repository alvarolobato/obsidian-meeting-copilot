// Deploy a local dev build to the Obsidian vault, self-consistently.
//
// The plugin verifies the `system-recorder` binary against EXPECTED_SHA256 in
// src/binary.ts. That value is a placeholder on `main` (CI re-pins it per
// release from the binary it actually builds/ships). A local build therefore
// won't match the binary in your vault, and the plugin re-downloads the release
// asset on every load — which also fails verification. This script pins the sha
// for the local build only, then reverts src/binary.ts so the worktree stays
// clean.
//
// Usage:
//   node deploy-local.mjs            # JS/CSS only; reuse the vault's binary (Case A)
//   node deploy-local.mjs --swift    # rebuild the Swift helper + deploy it (Case B)
//
// Vault plugin dir: $VAULT_PLUGIN_DIR (default below). data.json is never touched.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";

const DEST =
	process.env.VAULT_PLUGIN_DIR ??
	"/Users/alobato/git/notes/.obsidian/plugins/meeting-copilot";
const withSwift = process.argv.includes("--swift");
const BINARY_TS = "src/binary.ts";

function die(msg) {
	console.error(`deploy-local: ${msg}`);
	process.exit(1);
}

function sha256(file) {
	return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// Give a Mach-O a plain, location-independent ad-hoc signature. Two failure
// modes this fixes, both surfacing as a "Code Signature Invalid / Invalid Page"
// SIGKILL at launch (before main(), so no stderr — the process just dies):
//   1. The main executable: `swift build` emits a *linker-signed* ad-hoc
//      signature the kernel accepts only at the path the linker created it; once
//      copied (into the vault, or here even hashed-then-copied) it's rejected.
//   2. The whisper dylib: the pinned XCFramework ships it UNSIGNED, and recent
//      macOS's code-signing monitor refuses to map an unsigned dylib's code
//      pages into the (signed) helper. The old assumption that "dyld loads a
//      copied linker-signed dylib fine" no longer holds — it isn't even
//      linker-signed. So we sign it too, and (because signing changes its byte
//      size) pin WHISPER_DYLIB_SIZE + EXPECTED_WHISPER_SHA256 for this build so
//      the provisioner's size fast-path trusts the signed dylib instead of
//      re-downloading the unsigned release copy over it.
// Done in .build before hashing so the pinned shas match the deployed files.
// (Release assets are downloaded, which re-blesses them, so this is a
// local-deploy-only fixup.)
function adhocSign(file) {
	execFileSync("codesign", ["--force", "--sign", "-", file], { stdio: "inherit" });
}

if (!fs.existsSync(DEST)) {
	die(`vault plugin dir not found: ${DEST}\n  set VAULT_PLUGIN_DIR to override.`);
}

// 1. Resolve the binary + its sha (build the helper first when --swift).
let deployBinaryFrom = null; // set when we need to copy a fresh binary into DEST
let sha;
if (withSwift) {
	console.log("deploy-local: building Swift helper...");
	execFileSync("swift", ["build", "-c", "release"], {
		cwd: "swift-helper",
		stdio: "inherit",
	});
	const candidates = [
		"swift-helper/.build/release/SystemRecorder",
		...fs
			.readdirSync("swift-helper/.build", { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => `swift-helper/.build/${d.name}/release/SystemRecorder`),
	];
	deployBinaryFrom = candidates.find((p) => fs.existsSync(p));
	if (!deployBinaryFrom) die("built SystemRecorder not found under swift-helper/.build");
	// Re-sign before hashing so the sha we pin matches the binary we actually
	// deploy (the copy would otherwise invalidate its linker-signed signature).
	adhocSign(deployBinaryFrom);
	sha = sha256(deployBinaryFrom);
} else {
	const vaultBinary = path.join(DEST, "system-recorder");
	if (!fs.existsSync(vaultBinary)) {
		die(
			`no system-recorder in the vault to pin against.\n  run with --swift to build and deploy one.`
		);
	}
	sha = sha256(vaultBinary);
}
console.log(`deploy-local: pinning EXPECTED_SHA256 = ${sha}`);

// 1b. Resolve + ad-hoc sign the whisper dylib we'll deploy, then record its
// (post-signing) sha + size to pin below. With --swift that's the freshly built
// dylib in .build (copied into the vault in step 3); without, the dylib already
// in the vault, signed in place. Skipped only if there's no dylib yet (fresh
// non-swift deploy) — the plugin will provision it on first use.
let deployDylibFrom = null; // signed .build dylib to copy into DEST (null in non-swift)
let whisperSha = null;
let whisperSize = null;
if (withSwift) {
	deployDylibFrom = path.join(
		path.dirname(deployBinaryFrom),
		"whisper.framework/Versions/A/whisper"
	);
	if (!fs.existsSync(deployDylibFrom)) die(`built whisper dylib not found at ${deployDylibFrom}`);
	adhocSign(deployDylibFrom);
	whisperSha = sha256(deployDylibFrom);
	whisperSize = fs.statSync(deployDylibFrom).size;
} else {
	const vaultDylib = path.join(DEST, "whisper.framework/Versions/Current/whisper");
	if (fs.existsSync(vaultDylib)) {
		adhocSign(vaultDylib);
		whisperSha = sha256(vaultDylib);
		whisperSize = fs.statSync(vaultDylib).size;
	}
}
if (whisperSha) {
	console.log(
		`deploy-local: pinning EXPECTED_WHISPER_SHA256 = ${whisperSha} (size ${whisperSize})`
	);
}

// 2. Pin the sha for this build only, then always restore src/binary.ts.
const original = fs.readFileSync(BINARY_TS, "utf8");
let pinned = original.replace(
	/EXPECTED_SHA256\s*=\s*"[0-9a-f]*"/,
	`EXPECTED_SHA256 =\n\t"${sha}"`
);
if (pinned === original) die(`could not find EXPECTED_SHA256 assignment in ${BINARY_TS}`);
if (whisperSha && whisperSize) {
	const beforeWhisper = pinned;
	pinned = pinned
		.replace(
			/EXPECTED_WHISPER_SHA256\s*=\s*"[0-9a-f]*"/,
			`EXPECTED_WHISPER_SHA256 =\n\t"${whisperSha}"`
		)
		.replace(/WHISPER_DYLIB_SIZE\s*=\s*\d+/, `WHISPER_DYLIB_SIZE = ${whisperSize}`);
	if (pinned === beforeWhisper) {
		die(`could not find EXPECTED_WHISPER_SHA256 / WHISPER_DYLIB_SIZE assignment in ${BINARY_TS}`);
	}
}

try {
	fs.writeFileSync(BINARY_TS, pinned);
	console.log("deploy-local: building main.js...");
	execFileSync("npm", ["run", "build"], { stdio: "inherit" });
} finally {
	fs.writeFileSync(BINARY_TS, original); // keep the worktree clean no matter what
}

// 3. Copy artifacts (never data.json). fvad.wasm is optional — the build emits
// it only when the dep is installed; local VAD falls back gracefully without it.
for (const f of ["main.js", "manifest.json", "styles.css"]) {
	fs.copyFileSync(f, path.join(DEST, f));
}

// Stamp the DEPLOYED manifest with a real version so Obsidian's plugin list
// doesn't show the `main` placeholder (0.1.0). Derive it from git so it tracks
// the latest tag (+ commit/dirty for work past a tag). Only the vault copy is
// touched — the source manifest.json stays clean. The plugin builds its
// asset-download URL from this version, but a local deploy ships the pinned
// binary/dylib so provisioning is satisfied and never downloads.
let devVersion = null;
try {
	devVersion =
		execFileSync("git", ["describe", "--tags", "--dirty", "--always"], {
			encoding: "utf8",
		}).trim() || null;
} catch {
	devVersion = null;
}
if (devVersion) {
	const manifestPath = path.join(DEST, "manifest.json");
	const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	m.version = devVersion;
	fs.writeFileSync(manifestPath, JSON.stringify(m, null, "\t") + "\n");
	console.log(`deploy-local: stamped manifest version = ${devVersion}`);
}

if (fs.existsSync("fvad.wasm")) {
	fs.copyFileSync("fvad.wasm", path.join(DEST, "fvad.wasm"));
}
if (deployBinaryFrom) {
	const target = path.join(DEST, "system-recorder");
	fs.copyFileSync(deployBinaryFrom, target);
	fs.chmodSync(target, 0o755);

	// The helper links whisper.cpp's *dynamic* framework (issue #34): the binary
	// references @rpath/whisper.framework/Versions/Current/whisper and resolves
	// it at launch via SwiftPM's @loader_path rpath, so the dylib MUST sit next
	// to the binary or dyld fails before main() — breaking recording, not just
	// transcription. Reproduce the EXACT layout the release-time AssetProvisioner
	// writes for shipped users: a plain file at Versions/Current/whisper (a real
	// directory, no symlinks). Copying the built dylib (not the whole framework,
	// whose Versions/Current is an absolute symlink into this worktree's .build)
	// keeps the deployed plugin self-contained and validates the product layout.
	const frameworkDest = path.join(DEST, "whisper.framework");
	fs.rmSync(frameworkDest, { recursive: true, force: true });
	const dylibDest = path.join(frameworkDest, "Versions", "Current", "whisper");
	fs.mkdirSync(path.dirname(dylibDest), { recursive: true });
	// deployDylibFrom was ad-hoc signed above; the ad-hoc signature is embedded
	// in the Mach-O and path-independent, so the copy stays validly signed — and
	// its size matches the WHISPER_DYLIB_SIZE we pinned, so the provisioner's
	// size fast-path trusts it rather than re-fetching the unsigned release copy.
	fs.copyFileSync(deployDylibFrom, dylibDest);
}

console.log(`deploy-local: deployed to ${DEST}`);
console.log("deploy-local: reload the plugin in Obsidian (toggle off/on, or restart).");
if (withSwift) {
	console.log(
		"deploy-local: the binary changed — macOS may require re-granting Screen Recording\n" +
			"  permission (System Settings -> Privacy & Security -> Screen Recording), then restart Obsidian."
	);
}
