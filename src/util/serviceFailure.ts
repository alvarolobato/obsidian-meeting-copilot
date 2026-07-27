/**
 * Classify errors that mean "this HTTP endpoint is unhealthy / unreachable"
 * so callers can fail over to a configured fallback endpoint.
 *
 * Intentionally includes auth failures (401/403): a revoked primary key or
 * downed auth layer should still try the fallback. Excludes user cancel,
 * client validation (4xx other than 401/403/408/429), and empty-model replies.
 */

const NETWORK_HINTS = [
	"failed to fetch",
	"networkerror",
	"net::err_",
	"econnreset",
	"econnrefused",
	"enotfound",
	"etimedout",
	"socket hang up",
	"network request failed",
	"load failed",
];

/** HTTP statuses that indicate the *service* (not the request shape) is wrong. */
const SERVICE_HTTP = new Set([401, 403, 408, 429, 500, 502, 503, 504]);

function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function httpStatusFromMessage(msg: string): number | null {
	// Enrich: "LLM request failed (502): …"
	const enrich = msg.match(/LLM request failed \((\d{3})\)/);
	if (enrich) return Number(enrich[1]);
	// Vendor ApiClient: "API Error 503: …" / "HTTP 502 error"
	const api = msg.match(/\b(?:API Error|HTTP)\s+(\d{3})\b/i);
	if (api) return Number(api[1]);
	return null;
}

function looksLikeTimeout(msg: string): boolean {
	const lower = msg.toLowerCase();
	return (
		lower.includes("timed out") ||
		lower.includes("timeout") ||
		// EnrichTimeoutError name surfaces via stack rarely; message is enough.
		lower.includes("enrichtimeouterror")
	);
}

function looksLikeNetwork(msg: string): boolean {
	const lower = msg.toLowerCase();
	return NETWORK_HINTS.some((h) => lower.includes(h));
}

function isUserCancel(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const name = (error as { name?: string }).name;
	const msg = messageOf(error).toLowerCase();
	return (
		name === "ChatAbortError" ||
		name === "AbortError" ||
		msg.includes("cancelled") ||
		msg.includes("canceled") ||
		msg.includes("aborted")
	);
}

/**
 * True when `error` is a service-level failure worth trying a fallback endpoint.
 */
export function isServiceFailure(error: unknown): boolean {
	if (isUserCancel(error)) return false;
	const msg = messageOf(error);
	if (!msg) return false;
	if (looksLikeTimeout(msg)) return true;
	if (looksLikeNetwork(msg)) return true;
	const status = httpStatusFromMessage(msg);
	if (status !== null) return SERVICE_HTTP.has(status);
	// Named timeout errors from our code / vendor without a status code.
	if (
		error instanceof Error &&
		(error.name === "EnrichTimeoutError" ||
			error.name === "RequestTimeoutError")
	) {
		return true;
	}
	return false;
}
