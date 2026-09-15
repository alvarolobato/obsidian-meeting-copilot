/**
 * Fails unless manifest.json, package.json, and versions.json already hold the
 * release tag's version. release.yml runs it before building: the tagged commit
 * must carry the version itself, so the published manifest.json matches the
 * repository's (the Obsidian community directory compares the two). Cut
 * releases with `npm version`, which writes these files, commits, and tags.
 */
import { readFileSync } from "fs";

const tag = process.env.TAG;
if (!tag || !/^\d+\.\d+\.\d+$/.test(tag)) {
	console.error("TAG must be semver x.y.z (got %s)", tag ?? "(unset)");
	process.exit(1);
}

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const manifest = read("manifest.json");
const pkg = read("package.json");
const versions = read("versions.json");

const problems = [];
if (manifest.version !== tag) problems.push(`manifest.json version is ${manifest.version}`);
if (pkg.version !== tag) problems.push(`package.json version is ${pkg.version}`);
if (versions[tag] !== manifest.minAppVersion) {
	problems.push(
		`versions.json["${tag}"] is ${versions[tag] ?? "missing"} (expected ${manifest.minAppVersion})`
	);
}

if (problems.length > 0) {
	console.error(
		`Tag ${tag} doesn't match the committed version files:\n  - ${problems.join("\n  - ")}\n` +
			`Cut releases from main with:\n  npm version ${tag} -m "chore: release %s"\n  git push origin main --follow-tags`
	);
	process.exit(1);
}
console.log(`Version files match ${tag}`);
