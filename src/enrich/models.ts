import { requestUrl } from "obsidian";

/**
 * Lists model ids from an OpenAI-compatible `/models` endpoint (OpenAI, Azure,
 * a LiteLLM proxy, Ollama, …). Doubles as a connection test: it throws on a
 * non-2xx response. Mirrors how the AI Transcriber checks its connection.
 */
export async function listModels(
	baseUrl: string,
	apiKey: string
): Promise<string[]> {
	const url = `${baseUrl.replace(/\/+$/, "")}/models`;
	const res = await requestUrl({
		url,
		method: "GET",
		headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
		throw: false,
	});
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`HTTP ${res.status}`);
	}
	const data = res.json as { data?: { id?: unknown }[] } | undefined;
	const ids = (data?.data ?? [])
		.map((m) => m.id)
		.filter((id): id is string => typeof id === "string" && id.length > 0);
	return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}
