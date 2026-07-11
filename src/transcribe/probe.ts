/**
 * Probes whether the configured speech-to-text endpoint actually returns
 * segment timestamps for `verbose_json` requests. Deployment names on a
 * gateway (e.g. `llm-gateway/whisper`) don't tell us anything about the
 * backend behind them, so the only reliable way to know is to ask it with a
 * throwaway clip and look at what comes back. The WAV generation and response
 * parsing are pure so they can be unit-tested without a network stack; only
 * `probeTimestampSupport` itself talks to the endpoint.
 */
import { requestUrl } from "obsidian";

const SAMPLE_RATE = 16000;
const DURATION_SECONDS = 0.5;
const TONE_HZ = 440;
// Quiet on purpose: we only care that the backend accepts and transcribes the
// file, not what it makes of the tone.
const AMPLITUDE = 0.05;

/** Builds a ~0.5s, 16kHz mono 16-bit PCM WAV of a quiet sine tone, entirely in memory (no assets). */
export function makeProbeWav(): ArrayBuffer {
	const numSamples = Math.round(SAMPLE_RATE * DURATION_SECONDS);
	const dataSize = numSamples * 2; // 16-bit samples = 2 bytes each
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	writeAscii(view, 0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeAscii(view, 8, "WAVE");
	writeAscii(view, 12, "fmt ");
	view.setUint32(16, 16, true); // fmt chunk size (PCM)
	view.setUint16(20, 1, true); // AudioFormat = PCM
	view.setUint16(22, 1, true); // NumChannels = mono
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * 2, true); // ByteRate = SampleRate * BlockAlign
	view.setUint16(32, 2, true); // BlockAlign = channels * bytes/sample
	view.setUint16(34, 16, true); // BitsPerSample
	writeAscii(view, 36, "data");
	view.setUint32(40, dataSize, true);

	for (let i = 0; i < numSamples; i++) {
		const t = i / SAMPLE_RATE;
		const sample = Math.round(
			Math.sin(2 * Math.PI * TONE_HZ * t) * AMPLITUDE * 0x7fff
		);
		view.setInt16(44 + i * 2, sample, true);
	}

	return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
	for (let i = 0; i < text.length; i++) {
		view.setUint8(offset + i, text.charCodeAt(i));
	}
}

/**
 * True iff a parsed `/audio/transcriptions` response carries a `segments`
 * array, meaning the backend honored `response_format: verbose_json` (with
 * `timestamp_granularities[]=segment`). We check for the array's presence, not
 * its length: the probe clip is a short quiet tone, so a capable backend can
 * legitimately transcribe it to nothing and still return `segments: []`. A
 * backend that ignores verbose_json falls back to a plain-text shape with no
 * `segments` field at all, which is the case we want to catch.
 */
export function responseHasSegmentsArray(json: unknown): boolean {
	if (!json || typeof json !== "object") return false;
	const segments = (json as { segments?: unknown }).segments;
	return Array.isArray(segments);
}

/** Canonical `${baseUrl}::${wireModel}` a probe result was captured against, used to detect staleness after a config change. */
export function probeKey(baseUrl: string, wireModel: string): string {
	return `${baseUrl}::${wireModel}`;
}

interface MultipartFile {
	name: string;
	type: string;
	data: ArrayBuffer;
}

/** Builds a multipart/form-data body by hand. The vendored WhisperClient hands a FormData object to ApiClient, and ApiClient is what serializes it to raw bytes because Obsidian's requestUrl can't take a FormData; this does that serialization step directly. */
function buildMultipartBody(
	fields: Array<[string, string]>,
	file: MultipartFile
): { body: ArrayBuffer; contentType: string } {
	const boundary = `----MeetingCopilotProbe${Date.now()}`;
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];

	for (const [key, value] of fields) {
		chunks.push(encoder.encode(`--${boundary}\r\n`));
		chunks.push(
			encoder.encode(
				`Content-Disposition: form-data; name="${key}"\r\n\r\n`
			)
		);
		chunks.push(encoder.encode(`${value}\r\n`));
	}

	chunks.push(encoder.encode(`--${boundary}\r\n`));
	chunks.push(
		encoder.encode(
			`Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n`
		)
	);
	chunks.push(encoder.encode(`Content-Type: ${file.type}\r\n\r\n`));
	chunks.push(new Uint8Array(file.data));
	chunks.push(encoder.encode("\r\n"));
	chunks.push(encoder.encode(`--${boundary}--\r\n`));

	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const combined = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.length;
	}
	return {
		body: combined.buffer,
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

export interface ProbeTimestampSupportOptions {
	baseUrl: string;
	apiKey: string;
	/** The model id actually sent on the wire (a gateway deployment name, or the canonical id). */
	wireModel: string;
}

/**
 * Outcome of a probe. "unknown" means we couldn't get a verdict (transport,
 * HTTP, or parse failure) and must not be persisted as a definitive answer,
 * otherwise a transient 429 or timeout would stick as "unsupported" forever.
 */
export type TimestampSupport = "supported" | "unsupported" | "unknown";

/**
 * Sends a throwaway clip to `${baseUrl}/audio/transcriptions` asking for
 * `verbose_json` with segment timestamps, then reports whether a `segments`
 * array came back. Only a clean 2xx we could parse yields a real verdict;
 * anything else (network error, non-2xx, unparseable body) is "unknown" so the
 * caller can leave the stored result untouched rather than record a false "no".
 */
export async function probeTimestampSupport(
	opts: ProbeTimestampSupportOptions
): Promise<TimestampSupport> {
	try {
		const { body, contentType } = buildMultipartBody(
			[
				["model", opts.wireModel],
				["response_format", "verbose_json"],
				["timestamp_granularities[]", "segment"],
			],
			{ name: "probe.wav", type: "audio/wav", data: makeProbeWav() }
		);
		const res = await requestUrl({
			url: `${opts.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`,
			method: "POST",
			headers: {
				Authorization: `Bearer ${opts.apiKey}`,
				"Content-Type": contentType,
			},
			body,
			throw: false,
		});
		if (res.status < 200 || res.status >= 300) return "unknown";
		return responseHasSegmentsArray(res.json)
			? "supported"
			: "unsupported";
	} catch {
		return "unknown";
	}
}
