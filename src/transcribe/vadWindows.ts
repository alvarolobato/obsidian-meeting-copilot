/**
 * Local WebRTC-VAD speech-window detection for the diarized (me/them) path.
 *
 * The recorder ships a crude RMS energy gate (`speech.json`) that can't tell
 * speech from music, keyboard noise, or system-audio bleed into the mic — so
 * Whisper's silence hallucinations on the mostly-silent streams slip through.
 * Here we run the bundled WebRTC VAD (fvad.wasm) over each mono stream and emit
 * real speech windows, which `mergeDiarized` uses to drop any transcript
 * segment that lands outside detected speech.
 *
 * Crucially this is a *window* detector, not the silence-removing preprocessor:
 * we never touch the audio, so both streams keep their shared wall-clock and
 * the merge stays aligned. Windows are absolute seconds in the original stream.
 *
 * Everything degrades gracefully: if the WASM is missing (e.g. a BRAT install
 * that didn't fetch the asset), a stream is too long to safely decode (see
 * `MAX_VAD_DURATION_SECONDS`), or decoding fails, we return undefined and the
 * caller falls back to the recorder's speech.json (or no filtering at all).
 */
import { TFile } from "obsidian";

import { PathUtils } from "./vendor/utils/PathUtils";
import { WebRTCVADProcessor } from "./vendor/vad/processors/WebrtcVadProcessor";

import type { SpeechWindows } from "./diarize";
import type { VADConfig } from "./vendor/vad/VadTypes";
import type { App } from "obsidian";

/**
 * Tuned to over-keep rather than over-drop: windows only *gate* Whisper
 * segments (a segment survives if it touches any window), so generous padding
 * and gap-merging make it very unlikely to clip a real utterance, while still
 * rejecting the long silent stretches where Whisper invents filler.
 */
const VAD_CONFIG: VADConfig = {
	enabled: true,
	processor: "webrtc",
	// 0.6 -> fvad "aggressive" mode (2): rejects most non-speech energy without
	// being so strict it drops quiet talkers.
	sensitivity: 0.6,
	minSpeechDuration: 0.2,
	// Bridge sub-0.6s gaps so a single sentence stays one window.
	maxSilenceDuration: 0.6,
	// Pad each side so segment boundaries near a window edge still overlap it.
	speechPadding: 0.3,
	debug: false,
};

/** WebRTC VAD's native rate; decode straight to it to skip a second resample. */
const VAD_SAMPLE_RATE = 16000;

/**
 * Longest per-stream duration local VAD will attempt to decode. Generous
 * headroom above any real meeting, decisively below "recording left running
 * by mistake" (a real 15h recording OOM-crashed the renderer inside
 * `decodeMono16k` — see the memory note below). Streams longer than this
 * skip local VAD entirely and fall back to the recorder's RMS `speech.json`
 * gate, the same quality path already used when `fvad.wasm` is missing.
 *
 * Deliberately a duration cap, not a file-size cap: `decodeMono16k`'s memory
 * cost scales with decoded PCM duration, not encoded bytes, and this
 * recorder's AAC encoder compression ratio varies a lot with content (a real
 * 15h recording encoded to just ~1.5 MB/hour, ~20x smaller than its nominal
 * 64 kbps bitrate target — see `AudioMixer.aacBitRate` — so a byte-size cutoff
 * sized for "2h of audio" would have let that exact file through).
 */
const MAX_VAD_DURATION_SECONDS = 3 * 60 * 60;

/**
 * How long to wait for a duration probe before giving up on it. Best-effort:
 * a stuck or unsupported probe must never stall transcription, so a timeout
 * just means "treat as too long to be safe" (see `probeDurationSeconds`).
 */
const DURATION_PROBE_TIMEOUT_MS = 5000;

/**
 * Cheap metadata-only duration probe: loads just enough of the container to
 * read its duration (the `mvhd`/`mdhd` atom for m4a), never decoding audio
 * samples, so it can't hit the same OOM as `decodeMono16k`. Returns null if
 * the duration can't be determined (missing/corrupt metadata, or the probe
 * timed out) — callers must treat null as "unknown, assume unsafe."
 */
async function probeDurationSeconds(app: App, file: TFile): Promise<number | null> {
	return new Promise((resolve) => {
		const audio = new Audio();
		let settled = false;
		const finish = (result: number | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			audio.removeEventListener("loadedmetadata", onLoaded);
			audio.removeEventListener("error", onError);
			audio.src = "";
			resolve(result);
		};
		const onLoaded = (): void => {
			const d = audio.duration;
			finish(Number.isFinite(d) ? d : null);
		};
		const onError = (): void => finish(null);
		const timer = setTimeout(() => finish(null), DURATION_PROBE_TIMEOUT_MS);
		audio.addEventListener("loadedmetadata", onLoaded);
		audio.addEventListener("error", onError);
		audio.preload = "metadata";
		audio.src = app.vault.getResourcePath(file);
	});
}

/**
 * Whether either stream is too long (or of unknown duration) for local VAD to
 * safely decode. Pure so the threshold logic is unit-testable without mocking
 * `Audio`/Obsidian.
 */
export function exceedsVadDurationLimit(
	meDurationSeconds: number | null,
	themDurationSeconds: number | null
): boolean {
	const tooLong = (d: number | null): boolean =>
		d === null || d > MAX_VAD_DURATION_SECONDS;
	return tooLong(meDurationSeconds) || tooLong(themDurationSeconds);
}

/** Downmix an AudioBuffer to a single Float32 channel. */
function toMono(buffer: AudioBuffer): Float32Array {
	if (buffer.numberOfChannels === 1) {
		return buffer.getChannelData(0);
	}
	const length = buffer.length;
	const channels = buffer.numberOfChannels;
	const mono = new Float32Array(length);
	for (let ch = 0; ch < channels; ch++) {
		const data = buffer.getChannelData(ch);
		for (let i = 0; i < length; i++) {
			mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / channels;
		}
	}
	return mono;
}

/**
 * Decode an audio file (wav or m4a) to mono PCM at 16 kHz. Decoding into a
 * 16 kHz context lets the browser resample once, up front, so the whole file
 * never sits in RAM at the capture rate.
 *
 * Memory note: this still materializes the full mono stream (~115 MB/hour at
 * 16 kHz Float32) plus the VAD's internal Int16 copy. The two streams are
 * processed serially so only one is resident at a time. `computeSpeechWindows`
 * gates every call here behind `MAX_VAD_DURATION_SECONDS`, which is the real
 * protection: a genuine renderer OOM aborts the process rather than throwing a
 * catchable error (confirmed via a crash-report analysis of a real incident),
 * so the try/catch around this call can only save the caller from ordinary
 * decode failures, not from an OOM that's already underway.
 */
export async function decodeMono16k(
	app: App,
	file: TFile
): Promise<{ audioData: Float32Array; sampleRate: number }> {
	const buf = await app.vault.readBinary(file);
	const Ctor =
		window.AudioContext ??
		(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctor) {
		throw new Error("AudioContext unavailable");
	}
	const ctx = new Ctor({ sampleRate: VAD_SAMPLE_RATE });
	try {
		// slice(0): decodeAudioData detaches the buffer it's handed.
		const decoded = await ctx.decodeAudioData(buf.slice(0));
		return { audioData: toMono(decoded), sampleRate: decoded.sampleRate };
	} finally {
		void ctx.close();
	}
}

/**
 * Whether `fvad.wasm` is present in any location the loader searches. Checked up
 * front so a missing binary — a BRAT/community install before (or without) the
 * on-demand fetch, an offline first run — skips VAD *cleanly* instead of letting
 * the vendored processor throw and log two scary ERRORs on every diarized pass.
 * Missing is an expected, benign fallback (to the recorder's RMS windows), not a
 * failure worth surfacing.
 */
async function fvadWasmAvailable(app: App): Promise<boolean> {
	let paths: string[];
	try {
		paths = PathUtils.getWasmFilePaths(app, "fvad.wasm");
	} catch {
		return false;
	}
	for (const p of paths) {
		try {
			if (await app.vault.adapter.exists(p)) return true;
		} catch {
			// unreadable candidate — keep checking the rest
		}
	}
	return false;
}

/** Run VAD over one stream and return its speech windows as [start, end] seconds. */
async function windowsForFile(app: App, file: TFile): Promise<Array<[number, number]>> {
	const { audioData, sampleRate } = await decodeMono16k(app, file);
	const vad = new WebRTCVADProcessor(app, VAD_CONFIG, PathUtils.getCurrentPluginId());
	await vad.initialize();
	try {
		const result = await vad.processAudio(audioData, sampleRate);
		return result.segments.map((s) => [s.start, s.end] as [number, number]);
	} finally {
		await vad.cleanup();
	}
}

/**
 * Compute per-stream speech windows for the me/them sidecars using local WebRTC
 * VAD. Returns undefined (never throws) when VAD can't run, so callers can fall
 * back to the recorder's RMS speech.json.
 */
export async function computeSpeechWindows(
	app: App,
	meFile: TFile,
	themFile: TFile
): Promise<SpeechWindows | undefined> {
	try {
		// Skip cleanly when fvad.wasm isn't present (e.g. a BRAT install whose
		// on-demand fetch hasn't landed) so the vendored loader doesn't throw +
		// log ERRORs; the caller falls back to the recorder's RMS windows.
		if (!(await fvadWasmAvailable(app))) {
			console.debug(
				"[Meeting Copilot][vad] fvad.wasm not found; using recorder RMS windows"
			);
			return undefined;
		}
		const [meDuration, themDuration] = await Promise.all([
			probeDurationSeconds(app, meFile),
			probeDurationSeconds(app, themFile),
		]);
		if (exceedsVadDurationLimit(meDuration, themDuration)) {
			console.debug(
				`[Meeting Copilot][vad] stream too long for local VAD (me=${meDuration ?? "unknown"}s, them=${themDuration ?? "unknown"}s, limit=${MAX_VAD_DURATION_SECONDS}s); using recorder RMS windows`
			);
			return undefined;
		}
		// Serialize the two passes: each briefly holds the whole stream in RAM,
		// and they share the single vendored fvad module state.
		const me = await windowsForFile(app, meFile);
		const them = await windowsForFile(app, themFile);
		// debug, not warn: this runs on every diarized pass and the fallback
		// below is an expected, benign path (e.g. missing WASM on a BRAT
		// install), so it shouldn't look like a problem in the console.
		console.debug(
			`[Meeting Copilot][vad] local VAD windows: me=${me.length}, them=${them.length}`
		);
		return { me, them };
	} catch (error) {
		console.debug(
			"[Meeting Copilot][vad] local VAD unavailable; falling back to recorder RMS windows",
			error
		);
		return undefined;
	}
}
