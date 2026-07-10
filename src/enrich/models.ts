import { requestUrl } from "obsidian";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Lists model ids from an OpenAI-compatible `/models` endpoint (OpenAI, Azure,
 * a LiteLLM proxy, Ollama, …). Doubles as a connection test: it throws on a
 * non-2xx response. Mirrors how the AI Transcriber checks its connection.
 *
 * requestUrl can't be aborted, so it's raced against a timeout to guarantee the
 * caller's promise settles (otherwise the "Test connection" button can hang).
 */
export async function listModels(
	baseUrl: string,
	apiKey: string,
	timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string[]> {
	const url = `${baseUrl.replace(/\/+$/, "")}/models`;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(
						`Request timed out after ${Math.round(timeoutMs / 1000)}s`
					)
				),
			timeoutMs
		);
	});
	const request = requestUrl({
		url,
		method: "GET",
		headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
		throw: false,
	});
	let res;
	try {
		res = await Promise.race([request, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`HTTP ${res.status}`);
	}
	const data = res.json as { data?: { id?: unknown }[] } | undefined;
	const ids = (data?.data ?? [])
		.map((m) => m.id)
		.filter((id): id is string => typeof id === "string" && id.length > 0);
	return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}
