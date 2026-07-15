import { FileSystemAdapter, requestUrl, type Plugin } from "obsidian";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { AssetProvisionerDeps, ProvisionerDeps } from "./binary";

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

/** Absolute path to the plugin's local-model directory (created on demand). */
export function resolveModelDir(plugin: Plugin): string {
	const adapter = plugin.app.vault.adapter;
	const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
	return path.join(basePath, plugin.manifest.dir ?? "", "models");
}

/** Absolute path to a specific local model file under {@link resolveModelDir}. */
export function resolveModelPath(plugin: Plugin, fileName: string): string {
	return path.join(resolveModelDir(plugin), fileName);
}

/**
 * Streaming I/O for {@link AssetProvisioner}: models are hundreds of MB, so the
 * download goes straight to disk and the hash is computed from the file rather
 * than buffering the whole thing in renderer memory.
 */
export function assetNodeDeps(): AssetProvisionerDeps {
	return {
		fileExists: async (p) => {
			try {
				await fsp.access(p);
				return true;
			} catch {
				return false;
			}
		},
		fileSize: async (p) => (await fsp.stat(p)).size,
		sha256File: (p) =>
			new Promise<string>((resolve, reject) => {
				const hash = crypto.createHash("sha256");
				const rs = fs.createReadStream(p);
				rs.on("error", reject);
				rs.on("data", (chunk) => hash.update(chunk));
				rs.on("end", () => resolve(hash.digest("hex")));
			}),
		downloadToFile: async (url, destPath, onProgress) => {
			// Electron's renderer has a streaming fetch; requestUrl would buffer
			// the whole (500 MB) model into renderer memory, so stream fetch's
			// body to a write stream instead. This is the one place fetch is
			// preferred over requestUrl, precisely because it can stream.
			// eslint-disable-next-line no-restricted-globals -- requestUrl buffers the full body; a 500 MB model must stream to disk
			const res = await fetch(url);
			// Cancel the body on every early-exit path (non-2xx, mkdir/open
			// failure) so a failed download can't leak an open connection.
			if (!res.ok || !res.body) {
				await res.body?.cancel().catch(() => undefined);
				throw new Error(`HTTP ${res.status}`);
			}
			const reader = res.body.getReader();
			let out: fs.WriteStream | undefined;
			try {
				await fsp.mkdir(path.dirname(destPath), { recursive: true });
				out = fs.createWriteStream(destPath);
				const total = Number(res.headers.get("content-length") ?? 0);
				let received = 0;
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					received += value.byteLength;
					// value is a Uint8Array; WriteStream accepts it without a copy.
					if (!out.write(value)) {
						await new Promise<void>((resolve, reject) => {
							out!.once("error", reject);
							out!.once("drain", resolve);
						});
					}
					onProgress?.(received, total);
				}
				await new Promise<void>((resolve, reject) => {
					out!.on("error", reject);
					out!.end(() => resolve());
				});
			} catch (e) {
				out?.destroy();
				await reader.cancel().catch(() => undefined);
				throw e;
			}
		},
		rename: (from, to) => fsp.rename(from, to),
		unlink: (p) => fsp.unlink(p),
	};
}
