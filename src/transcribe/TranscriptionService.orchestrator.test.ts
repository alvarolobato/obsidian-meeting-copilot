import { beforeAll, describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { transcribeAudio, transcribeDiarized } from "./TranscriptionService";
import type {
	JobResult,
	TranscribeRequest,
	TranscriptionBackend,
} from "./backend";
import { initializeTranslations } from "./vendor/i18n/index";
import en from "./vendor/i18n/translations/en";
import ja from "./vendor/i18n/translations/ja";
import ko from "./vendor/i18n/translations/ko";
import zh from "./vendor/i18n/translations/zh";

// The orchestrator is now backend-agnostic: it builds jobs, drives the
// capability-miss early-bail via `continueAfterJob`, classifies each returned
// job, and merges. These tests exercise that logic against a fake backend, so
// no vendored controller / audio pipeline is needed.

beforeAll(() => {
	// isDiarizationCancelled resolves the cancelled-by-user message via t().
	initializeTranslations({ en, ja, ko, zh });
});

function fakeFile(path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path;
	return f;
}

/**
 * A backend that runs jobs sequentially exactly like the real one: it produces
 * a canned result per job id and honors `continueAfterJob`, so the early-bail
 * contract is exercised end to end. `ranJobs` records what actually ran.
 */
function sequentialBackend(
	resultsById: Record<string, JobResult>
): TranscriptionBackend & { ranJobs: string[]; lastRequest?: TranscribeRequest } {
	const backend = {
		id: "openai-compatible" as const,
		ranJobs: [] as string[],
		lastRequest: undefined as TranscribeRequest | undefined,
		async validateConfig() {
			return { ok: true };
		},
		async transcribe(req: TranscribeRequest): Promise<JobResult[]> {
			backend.lastRequest = req;
			const out: JobResult[] = [];
			for (let i = 0; i < req.jobs.length; i++) {
				const job = req.jobs[i]!;
				backend.ranJobs.push(job.id);
				const r = resultsById[job.id] ?? { id: job.id, text: "" };
				out.push(r);
				if (i < req.jobs.length - 1 && req.continueAfterJob && !req.continueAfterJob(r)) {
					break;
				}
			}
			return out;
		},
	};
	return backend;
}

function throwingBackend(error: unknown): TranscriptionBackend {
	return {
		id: "openai-compatible",
		async validateConfig() {
			return { ok: true };
		},
		async transcribe(): Promise<JobResult[]> {
			throw error;
		},
	};
}

describe("transcribeAudio", () => {
	it("runs one non-diarized job over the whole file and returns its text", async () => {
		const backend = sequentialBackend({ single: { id: "single", text: "hello world" } });
		const out = await transcribeAudio(fakeFile("a.wav"), backend);
		expect(out).toBe("hello world");
		expect(backend.lastRequest?.jobs).toEqual([
			{ id: "single", file: fakeFile("a.wav"), wantSegments: false },
		]);
	});

	it("returns empty string when the backend yields no result", async () => {
		const backend = sequentialBackend({});
		// Backend returns [] would give undefined; our sequential fake always
		// returns one result per job, so simulate an empty transcript instead.
		expect(await transcribeAudio(fakeFile("a.wav"), backend)).toBe("");
	});
});

describe("transcribeDiarized", () => {
	const seg = (text: string, start: number, end: number) => ({ text, start, end });

	it("merges both passes into a speaker-labelled transcript", async () => {
		const backend = sequentialBackend({
			me: { id: "me", text: "hi", segments: [seg("hi there", 0, 1)] },
			them: { id: "them", text: "yo", segments: [seg("hello back", 2, 3)] },
		});
		const result = await transcribeDiarized(fakeFile("x.me.wav"), fakeFile("x.them.wav"), backend);
		expect(result.diarized).toBe(true);
		expect(result.text).toContain("Me: hi there");
		expect(result.text).toContain("Them: hello back");
		expect(backend.ranJobs).toEqual(["me", "them"]);
	});

	it("stops after the me pass on a capability miss (skips them)", async () => {
		const backend = sequentialBackend({
			me: { id: "me", text: "real words here", segments: [] },
			them: { id: "them", text: "unused", segments: [seg("x", 0, 1)] },
		});
		const result = await transcribeDiarized(fakeFile("x.me.wav"), fakeFile("x.them.wav"), backend);
		expect(result).toEqual({ text: "", diarized: false, reason: "capability" });
		expect(backend.ranJobs).toEqual(["me"]);
	});

	it("classifies a them-pass capability miss (both passes ran)", async () => {
		const backend = sequentialBackend({
			me: { id: "me", text: "hi", segments: [seg("hi", 0, 1)] },
			them: { id: "them", text: "real words here", segments: [] },
		});
		const result = await transcribeDiarized(fakeFile("x.me.wav"), fakeFile("x.them.wav"), backend);
		expect(result.reason).toBe("capability");
		expect(backend.ranJobs).toEqual(["me", "them"]);
	});

	it("treats two silent streams as a valid empty diarized result", async () => {
		const backend = sequentialBackend({
			me: { id: "me", text: "", segments: [] },
			them: { id: "them", text: "", segments: [] },
		});
		const result = await transcribeDiarized(fakeFile("x.me.wav"), fakeFile("x.them.wav"), backend);
		expect(result).toEqual({ text: "", diarized: true });
		expect(backend.ranJobs).toEqual(["me", "them"]);
	});

	it("falls back with reason 'error' on a transient failure", async () => {
		const result = await transcribeDiarized(
			fakeFile("x.me.wav"),
			fakeFile("x.them.wav"),
			throwingBackend(new Error("network blip"))
		);
		expect(result).toEqual({ text: "", diarized: false, reason: "error" });
	});

	it("re-throws a cancellation rather than swallowing it into a fallback", async () => {
		await expect(
			transcribeDiarized(
				fakeFile("x.me.wav"),
				fakeFile("x.them.wav"),
				throwingBackend(new DOMException("stopped", "AbortError"))
			)
		).rejects.toThrow();
	});

	it("pre-gates a stream only when its detector produced windows", async () => {
		const backend = sequentialBackend({
			me: { id: "me", text: "", segments: [] },
			them: { id: "them", text: "", segments: [] },
		});
		await transcribeDiarized(
			fakeFile("x.me.wav"),
			fakeFile("x.them.wav"),
			backend,
			{ me: [[0, 1]], them: [[2, 3]] },
			undefined,
			undefined,
			{ me: "vad", them: "none" }
		);
		const jobs = backend.lastRequest!.jobs;
		const me = jobs.find((j) => j.id === "me")!;
		const them = jobs.find((j) => j.id === "them")!;
		// me had VAD windows -> pre-gate with the "vad" source.
		expect(me.speechWindows).toEqual([[0, 1]]);
		expect(me.windowSource).toBe("vad");
		// them's detector heard nothing ("none") -> full pass, no pre-gate.
		expect(them.speechWindows).toBeUndefined();
		expect(them.windowSource).toBeUndefined();
	});
});
