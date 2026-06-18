import { FileSystemAdapter, requestUrl, type Plugin } from "obsidian";
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
		unlink: (p) => fsp.unlink(p),
		download: async (url) => {
			// requestUrl follows redirects automatically (GitHub release assets 302 to a CDN);
			// res.status is the final response code.
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
	const adapter = plugin.app.vault.adapter;
	const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
	return path.join(basePath, plugin.manifest.dir ?? "", "system-recorder");
}
