/**
 * Build provenance, baked into the bundle at build time by esbuild's `define`
 * (see `esbuild.config.mjs`). Lets the plugin distinguish an official release
 * from a local/custom build so the version it shows is honest about its origin.
 */
export interface BuildInfo {
	/** Short git commit the bundle was built from, or null if git was unavailable. */
	commit: string | null;
	/** Git branch at build time (often "HEAD" in CI detached checkouts), or null. */
	branch: string | null;
	/** UTC build date (YYYY-MM-DD), or null. */
	buildDate: string | null;
	/** True only for tagged release builds (release.yml sets MC_RELEASE=1). */
	isRelease: boolean;
}

// Replaced by esbuild `define`. Guarded with `typeof` so contexts that don't run
// our esbuild config (e.g. vitest) don't hit a ReferenceError and fall back to a
// safe "unknown custom build" default.
declare const __MC_BUILD__: BuildInfo | undefined;

export const buildInfo: BuildInfo =
	typeof __MC_BUILD__ !== "undefined"
		? __MC_BUILD__
		: { commit: null, branch: null, buildDate: null, isRelease: false };

/**
 * A human-readable version label.
 *
 * - **Release build** → just the version, e.g. `1.2.3`.
 * - **Custom/local build** → the version plus a parenthesised marker with
 *   whatever provenance we have, e.g. `1.2.3 (custom build: feat/x · a1b2c3d ·
 *   2026-07-21)`. The branch is omitted when it's a detached `HEAD`.
 *
 * `customBuildLabel` is injected by the caller so the word can be localised
 * (defaults to English for non-UI callers like the load-time log). `info` is a
 * parameter so it can be unit-tested without rebuilding.
 */
export function describeVersion(
	version: string,
	customBuildLabel = "custom build",
	info: BuildInfo = buildInfo
): string {
	if (info.isRelease) return version;
	const parts: string[] = [];
	if (info.branch && info.branch !== "HEAD") parts.push(info.branch);
	if (info.commit) parts.push(info.commit);
	if (info.buildDate) parts.push(info.buildDate);
	const detail = parts.length
		? `${customBuildLabel}: ${parts.join(" · ")}`
		: customBuildLabel;
	return `${version} (${detail})`;
}
