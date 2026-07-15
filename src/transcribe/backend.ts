/**
 * The pluggable transcription backend seam.
 *
 * `TranscriptionService` is a backend-agnostic *orchestrator* (diarized pass,
 * capability-miss classification, merge, probe invalidation); the actual
 * transcription — endpoint config, chunking, progress, partial detection — is
 * owned by a `TranscriptionBackend`. Today the only implementation is
 * {@link ./OpenAICompatibleBackend} (the vendored engine + serial queue +
 * process-global endpoint seam, all hidden inside it); a local on-device
 * backend (issue #34) drops in against this same interface.
 *
 * Endpoint/model/language/dictionary config is a property of a *backend
 * instance* (constructed once from settings), not of a per-call request — so a
 * request carries only the per-call work (which files, progress, cancellation).
 */
import type { TFile } from "obsidian";
import type { DiarSegment } from "./diarize";

/** How a job's speech windows were derived, so a backend can pick padding. */
export type SpeechWindowSource = "vad" | "rms";

/** One audio file to transcribe within a request. */
export interface TranscribeJob {
	/** Stable id echoed back on the result ("single" | "me" | "them"). */
	id: string;
	file: TFile;
	/** Diarized passes need timestamped segments; the mixed pass doesn't. */
	wantSegments: boolean;
	/**
	 * Speech time-ranges (absolute seconds on the file's own clock) to restrict
	 * transcription to, skipping silence (pre-gating, issue #67). Whole file
	 * when omitted. Segment times are ALWAYS on the file's own clock.
	 */
	speechWindows?: Array<[number, number]>;
	/** How {@link speechWindows} were derived, so the backend can size padding. */
	windowSource?: SpeechWindowSource;
}

/** Typed partial marker — replaces the localized-prose string sniffing. */
export interface PartialInfo {
	processedChunks: number;
	totalChunks: number;
	reason: string;
}

/** The transcription of a single {@link TranscribeJob}. */
export interface JobResult {
	id: string;
	text: string;
	/** Present when `wantSegments` was set and the backend produced segments. */
	segments?: DiarSegment[];
	partial?: PartialInfo;
}

export interface TranscribeRequest {
	jobs: TranscribeJob[];
	/** 0–100 for the whole request; the backend weights the bar across jobs. */
	onProgress?: (percent: number) => void;
	signal?: AbortSignal;
	/**
	 * Consulted between sequential jobs: return `false` after a job's result to
	 * stop early and return the results gathered so far, skipping the remaining
	 * jobs. The diarized orchestrator uses this to skip the second (them) pass
	 * when the first (me) pass is a capability miss — preserving today's "don't
	 * spend a doomed second pass" behavior. Defaults to "always continue".
	 */
	continueAfterJob?: (result: JobResult) => boolean;
}

export interface ValidationResult {
	ok: boolean;
	message?: string;
}

export interface TranscriptionBackend {
	readonly id: "openai-compatible" | "whisper-cpp";
	/** Cheap, side-effect-free; gates the settings toggle and pre-run checks. */
	validateConfig(): Promise<ValidationResult>;
	/**
	 * Transcribe every job in one call (so a local backend can amortize model
	 * load). Jobs run sequentially; progress is reported 0–100 across the whole
	 * request. Throws on cancellation and on unrecoverable failure.
	 */
	transcribe(req: TranscribeRequest): Promise<JobResult[]>;
}
