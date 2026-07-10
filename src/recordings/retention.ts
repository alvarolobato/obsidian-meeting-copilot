/** Minimal file descriptor so the selection logic stays pure and testable. */
export interface AudioFileInfo {
	path: string;
	/** Lower/upper-case extension without the dot, e.g. "wav". */
	ext: string;
	/** Last-modified time in epoch ms. */
	mtime: number;
}

export interface RetentionConfig {
	/** Only files under one of these folders are eligible (empty = whole vault). */
	folders: string[];
	/** Recordings older than this many days are expired. 0/negative disables cleanup. */
	retentionDays: number;
	/** "Now" in epoch ms. */
	now: number;
	/** Paths that must never be removed (e.g. the in-progress recording). */
	protectedPaths?: Set<string>;
}

const AUDIO_EXTENSIONS = new Set(["wav", "m4a", "mp3", "webm", "ogg", "flac"]);

/** True for extensions we treat as recordings. */
export function isAudioExt(ext: string): boolean {
	return AUDIO_EXTENSIONS.has(ext.toLowerCase());
}

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeFolder(folder: string): string {
	return folder.trim().replace(/\/+$/, "");
}

/** True if `path` is inside (or equal to) `folder`. */
function underFolder(path: string, folder: string): boolean {
	if (!folder) return false;
	return path === folder || path.startsWith(`${folder}/`);
}

/**
 * Returns the audio files that are past the retention window and eligible for
 * cleanup. Pure: takes a snapshot of files + config and returns the subset to
 * remove, so it can be unit-tested without a vault.
 */
export function findExpiredRecordings(
	files: AudioFileInfo[],
	cfg: RetentionConfig
): AudioFileInfo[] {
	if (cfg.retentionDays <= 0) return [];
	const cutoff = cfg.now - cfg.retentionDays * DAY_MS;
	const folders = cfg.folders.map(normalizeFolder).filter(Boolean);
	return files.filter(
		(f) =>
			isAudioExt(f.ext) &&
			f.mtime < cutoff &&
			(folders.length === 0 ||
				folders.some((folder) => underFolder(f.path, folder))) &&
			!cfg.protectedPaths?.has(f.path)
	);
}
