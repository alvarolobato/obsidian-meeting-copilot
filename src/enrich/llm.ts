import { requestUrl } from "obsidian";

export interface ChatParams {
	baseUrl: string;
	apiKey: string;
	model: string;
	system: string;
	user: string;
	temperature?: number;
	/** Abort the request after this many ms (default 120s). */
	timeoutMs?: number;
	/**
	 * Cancels the call: the returned promise rejects promptly with an AbortError
	 * when this fires. requestUrl itself can't be aborted mid-flight, so the
	 * in-flight request may still complete in the background, but the caller is
	 * freed to release its queue slot / UI state (mirrors the timeout race).
	 */
	signal?: AbortSignal;
}

/** Thrown when {@link chatComplete} is cancelled via its `signal`. */
export class ChatAbortError extends Error {
	constructor() {
		super("LLM request cancelled");
		this.name = "ChatAbortError";
	}
}

/** Thrown when {@link chatComplete} hits its timeout budget (#128). */
export class EnrichTimeoutError extends Error {
	readonly timeoutMs: number;
	constructor(timeoutMs: number) {
		super(
			`LLM request timed out after ${Math.round(timeoutMs / 1000)}s`
		);
		this.name = "EnrichTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

interface ChatResponse {
	choices?: { message?: { content?: string } }[];
	error?: { message?: string };
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Calls an OpenAI-compatible `/chat/completions` endpoint (OpenAI, Azure,
 * LiteLLM proxy, Ollama, …) via Obsidian's requestUrl to avoid CORS.
 *
 * Note: requestUrl can't be aborted, but racing it against a timeout ensures
 * the caller's promise always settles, so callers can release locks/UI state.
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
	if (p.signal?.aborted) throw new ChatAbortError();
	const timeoutMs = p.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new EnrichTimeoutError(timeoutMs)),
			timeoutMs
		);
	});
	// Reject as soon as the caller cancels, so a queued/running enrich releases
	// its slot instead of waiting out the whole timeout.
	let onAbort: (() => void) | undefined;
	const aborted = new Promise<never>((_, reject) => {
		const signal = p.signal;
		if (!signal) return;
		onAbort = () => reject(new ChatAbortError());
		signal.addEventListener("abort", onAbort, { once: true });
	});
	const request = requestUrl({
		url,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${p.apiKey}`,
		},
		body: JSON.stringify(payload),
		throw: false,
	});
	// The request may lose the race (timeout/abort wins) yet still reject later
	// (e.g. a network error) — keep its rejection handled so it can't surface as
	// an unhandled rejection (mirrors ApiClient.requestWithTimeout).
	request.catch(() => {});
	let res;
	try {
		res = await Promise.race([request, timeout, aborted]);
	} finally {
		if (timer) clearTimeout(timer);
		if (onAbort) p.signal?.removeEventListener("abort", onAbort);
	}

	// Status before `.json`: Obsidian's getter parses on access, so a 502 HTML
	// body would throw SyntaxError instead of a useful LLM status error (#119).
	if (res.status < 200 || res.status >= 300) {
		let detail = "";
		try {
			const errBody = res.json as ChatResponse | undefined;
			detail = errBody?.error?.message ?? "";
		} catch {
			/* non-JSON error body */
		}
		if (!detail && typeof res.text === "string") {
			detail = res.text.slice(0, 300);
		}
		throw new Error(`LLM request failed (${res.status}): ${detail}`);
	}

	let data: ChatResponse | undefined;
	try {
		data = res.json as ChatResponse | undefined;
	} catch {
		throw new Error(
			`LLM request failed (${res.status}): response was not JSON`
		);
	}

	const content = data?.choices?.[0]?.message?.content;
	if (!content || content.trim().length === 0) {
		throw new Error("LLM returned no content");
	}
	return content.trim();
}
