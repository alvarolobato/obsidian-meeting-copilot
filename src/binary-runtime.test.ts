import { afterEach, describe, expect, it, vi } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { assetNodeDeps } from "./binary-runtime";

// The streaming download is the highest-risk piece of the model provisioner
// (backpressure, HTTP handling, body cleanup), so exercise it against a mocked
// streaming fetch writing to a real temp file.

function streamFrom(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
	let i = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (i < chunks.length) {
				controller.enqueue(chunks[i++]);
			} else {
				controller.close();
			}
		},
		cancel() {
			onCancel?.();
		},
	});
}

function fakeResponse(opts: {
	ok: boolean;
	status: number;
	body: ReadableStream<Uint8Array> | null;
	contentLength?: number;
}): Response {
	return {
		ok: opts.ok,
		status: opts.status,
		body: opts.body,
		headers: {
			get: (k: string) =>
				k.toLowerCase() === "content-length" && opts.contentLength !== undefined
					? String(opts.contentLength)
					: null,
		},
	} as unknown as Response;
}

async function tmpPath(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-dl-"));
	return path.join(dir, "sub", "model.bin");
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("assetNodeDeps().downloadToFile", () => {
	it("streams the body to disk, creating parent dirs, and reports progress", async () => {
		const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				fakeResponse({ ok: true, status: 200, body: streamFrom(chunks), contentLength: 5 })
			)
		);
		const dest = await tmpPath();
		const seen: Array<[number, number]> = [];
		await assetNodeDeps().downloadToFile("https://x/model.bin", dest, (r, t) =>
			seen.push([r, t])
		);
		const written = await fs.readFile(dest);
		expect([...written]).toEqual([1, 2, 3, 4, 5]);
		expect(seen).toEqual([
			[3, 5],
			[5, 5],
		]);
	});

	it("reports total 0 when Content-Length is absent (HF CDN redirect)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				fakeResponse({ ok: true, status: 200, body: streamFrom([new Uint8Array([9])]) })
			)
		);
		const dest = await tmpPath();
		const seen: Array<[number, number]> = [];
		await assetNodeDeps().downloadToFile("https://x/model.bin", dest, (r, t) =>
			seen.push([r, t])
		);
		expect(seen).toEqual([[1, 0]]);
	});

	it("throws HTTP <status> and cancels the body on a non-2xx response", async () => {
		let cancelled = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				fakeResponse({
					ok: false,
					status: 404,
					body: streamFrom([new Uint8Array([1])], () => {
						cancelled = true;
					}),
				})
			)
		);
		const dest = await tmpPath();
		await expect(
			assetNodeDeps().downloadToFile("https://x/model.bin", dest)
		).rejects.toThrow("HTTP 404");
		expect(cancelled).toBe(true);
		// Nothing should have been written for a rejected response.
		await expect(fs.readFile(dest)).rejects.toBeTruthy();
	});
});
