/**
 * Obsidian's console exporter stringifies only the first argument of
 * `console.warn`, so a second-arg object becomes the literal word `Object` in
 * bug-report exports (#129). Always fold structured data into one string.
 */

const MAX_STRING = 500;

function safeReplacer(_key: string, value: unknown): unknown {
	if (typeof value === "string" && value.length > MAX_STRING) {
		return `${value.slice(0, MAX_STRING)}…`;
	}
	if (value instanceof Error) {
		return { name: value.name, message: value.message };
	}
	return value;
}

/** JSON-encode log payloads for single-string console lines. */
export function formatLogData(data: Record<string, unknown>): string {
	try {
		return JSON.stringify(data, safeReplacer);
	} catch {
		return "[unserializable]";
	}
}

/**
 * Always-on Meeting Copilot diagnostic line (one string — export-safe).
 * Prefer this over `console.warn(msg, obj)` so console exports stay readable.
 */
export function mcLog(
	channel: string,
	event: string,
	data?: Record<string, unknown>
): void {
	if (data) {
		console.warn(
			`[Meeting Copilot][${channel}] ${event} ${formatLogData(data)}`
		);
	} else {
		console.warn(`[Meeting Copilot][${channel}] ${event}`);
	}
}
