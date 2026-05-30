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
		unlink: (p) => fsp.unlink(p),
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
