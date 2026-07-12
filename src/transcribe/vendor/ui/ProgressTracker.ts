/**
 * Headless ProgressTracker for the vendored TranscriptionController's optional
 * `progressTracker` dependency. Upstream drove this from a modal UI
 * (startTask/completeTask/getCurrentTask); Meeting Copilot runs the engine
 * headlessly, so this keeps a single always-live "current task" — enough for
 * the controller's progress adapter to fire — and forwards the engine's unified
 * percentage to a caller-supplied callback (e.g. the status bar). See VENDOR.md.
 */
import type { TFile } from "obsidian";

export interface TranscriptionTask {
	id: string;
	totalChunks: number;
	[key: string]: unknown;
}

export class ProgressTracker {
	private task: TranscriptionTask;
	private readonly onProgress: (percent: number) => void;

	/** `onProgress` receives the engine's unified percentage (roughly 10–90 during transcription). */
	constructor(onProgress: (percent: number) => void, totalChunks = 1) {
		this.onProgress = onProgress;
		this.task = { id: "mc-transcribe", totalChunks: Math.max(1, totalChunks) };
	}

	startTask(_file: TFile, totalChunks: number): string {
		this.task = {
			id: "mc-transcribe",
			totalChunks: Math.max(1, totalChunks),
		};
		return this.task.id;
	}

	updateProgress(
		_taskId: string,
		_completedChunks: number,
		_message?: string,
		unifiedPercentage?: number
	): void {
		if (typeof unifiedPercentage === "number") {
			this.onProgress(unifiedPercentage);
		}
	}

	updateTotalChunks(_taskId: string, totalChunks: number): void {
		this.task.totalChunks = Math.max(1, totalChunks);
	}

	completeTask(): void {
		this.onProgress(100);
	}

	cancelTask(): void {
		// Cancellation is driven by the AbortSignal, not this tracker; no-op.
	}

	getCurrentTask(): TranscriptionTask | null {
		return this.task;
	}
}
