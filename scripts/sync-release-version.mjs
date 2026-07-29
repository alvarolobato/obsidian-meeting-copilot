/**
 * Set manifest.json, versions.json, and package.json to a release tag.
 * Used by release.yml (build artifacts) and to sync main after a tag push.
 */
import { readFileSync, writeFileSync } from "fs";

const tag = process.env.TAG;
if (!tag || !/^\d+\.\d+\.\d+$/.test(tag)) {
	console.error("TAG must be semver x.y.z (got %s)", tag ?? "(unset)");
	process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = tag;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[tag] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = tag;
writeFileSync("package.json", JSON.stringify(pkg, null, "\t") + "\n");

console.log(`Synced manifest/versions/package to ${tag}`);
