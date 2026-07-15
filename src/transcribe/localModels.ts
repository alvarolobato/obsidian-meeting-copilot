/**
 * Registry of local on-device Whisper models (ggml, for whisper.cpp — issue
 * #34). Only **multilingual** variants are listed: `sttLanguage` can be any
 * language, and the English-only (`.en`) models would silently mis-handle it.
 *
 * Each model is downloaded from the canonical `ggerganov/whisper.cpp` Hugging
 * Face repo and verified by a pinned SHA-256 (the Git-LFS content hash), the
 * same trust model as the recorder binary. The models are immutable, so pinning
 * by hash is safe and re-downloading is only needed when a file is missing or
 * partial.
 */
export interface LocalModelSpec {
	/** Stable key stored in settings (`localWhisperModel`). */
	id: string;
	/** Human label for the settings dropdown. */
	label: string;
	/** On-disk filename under the plugin's `models/` dir. */
	fileName: string;
	/** Hugging Face `resolve` URL for the ggml file. */
	url: string;
	/** SHA-256 (hex) of the file content — the Git-LFS oid. */
	sha256: string;
	/** Exact file size in bytes; the cheap "already downloaded?" check. */
	sizeBytes: number;
	/** Approximate peak RAM the model needs when loaded, for the UI hint. */
	approxRamMb: number;
}

const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

function hfUrl(fileName: string): string {
	return `${HF_BASE}/${fileName}`;
}

/**
 * The offered models, smallest → largest. `large-v3-turbo-q5_0` is the default:
 * near large-v3 quality at a fraction of the compute, ~90x real-time on
 * Apple-Silicon Max tiers. `small`/`medium` trade accuracy for size/RAM on
 * lower-end machines.
 */
export const LOCAL_MODELS: Record<string, LocalModelSpec> = {
	"small-q5_1": {
		id: "small-q5_1",
		label: "Small (q5_1) — 190 MB, fastest, lower accuracy",
		fileName: "ggml-small-q5_1.bin",
		url: hfUrl("ggml-small-q5_1.bin"),
		sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
		sizeBytes: 190085487,
		approxRamMb: 600,
	},
	"medium-q5_0": {
		id: "medium-q5_0",
		label: "Medium (q5_0) — 539 MB, balanced",
		fileName: "ggml-medium-q5_0.bin",
		url: hfUrl("ggml-medium-q5_0.bin"),
		sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
		sizeBytes: 539212467,
		approxRamMb: 1600,
	},
	"large-v3-turbo-q5_0": {
		id: "large-v3-turbo-q5_0",
		label: "Large v3 Turbo (q5_0) — 574 MB, best (recommended)",
		fileName: "ggml-large-v3-turbo-q5_0.bin",
		url: hfUrl("ggml-large-v3-turbo-q5_0.bin"),
		sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
		sizeBytes: 574041195,
		approxRamMb: 1600,
	},
};

/** The default local model id (also the {@link DEFAULT_SETTINGS} value). */
export const DEFAULT_LOCAL_MODEL_ID = "large-v3-turbo-q5_0";

/** Resolve a model id to its spec, falling back to the default for an unknown id. */
export function localModelSpec(id: string): LocalModelSpec {
	return LOCAL_MODELS[id] ?? LOCAL_MODELS[DEFAULT_LOCAL_MODEL_ID]!;
}

/** Format a byte count as a compact "MB"/"GB" string for the UI. */
export function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}
	return `${Math.round(bytes / (1024 * 1024))} MB`;
}
