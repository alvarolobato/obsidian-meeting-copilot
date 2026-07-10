import { requestUrl } from "obsidian";

export interface ChatParams {
	baseUrl: string;
	apiKey: string;
	model: string;
	system: string;
	user: string;
	temperature?: number;
}

interface ChatResponse {
	choices?: { message?: { content?: string } }[];
	error?: { message?: string };
}

/**
 * Calls an OpenAI-compatible `/chat/completions` endpoint (OpenAI, Azure,
 * LiteLLM proxy, Ollama, …) via Obsidian's requestUrl to avoid CORS.
 */
export async function chatComplete(p: ChatParams): Promise<string> {
	const url = `${p.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	// Only send `temperature` when explicitly requested. Several newer models
	// (Claude Sonnet 5, GPT-5 / o-series, …) reject it with a 400, so the
	// default is to omit it and let the model use its own default.
	const payload: Record<string, unknown> = {
		model: p.model,
		messages: [
			{ role: "system", content: p.system },
			{ role: "user", content: p.user },
		],
	};
	if (typeof p.temperature === "number") {
		payload.temperature = p.temperature;
	}
	const res = await requestUrl({
		url,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${p.apiKey}`,
		},
		body: JSON.stringify(payload),
		throw: false,
	});

	const data = res.json as ChatResponse | undefined;
	if (res.status < 200 || res.status >= 300) {
		const detail =
			data?.error?.message ??
			(typeof res.text === "string" ? res.text.slice(0, 300) : "");
		throw new Error(`LLM request failed (${res.status}): ${detail}`);
	}

	const content = data?.choices?.[0]?.message?.content;
	if (!content || content.trim().length === 0) {
		throw new Error("LLM returned no content");
	}
	return content.trim();
}
