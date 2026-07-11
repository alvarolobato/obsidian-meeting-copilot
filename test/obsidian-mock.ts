// Minimal `obsidian` stand-in for unit tests. Obsidian bundles moment at
// runtime; here we re-export the real moment package so date formatting in
// template rendering can be exercised without the Obsidian app.
/* eslint-disable no-restricted-imports, import/no-extraneous-dependencies */
import moment from "moment";

export { moment };

// --- requestUrl: tests swap in an implementation via __setRequestUrl ---
export interface MockRequestResponse {
	status: number;
	json?: unknown;
	text?: string;
}
type RequestUrlImpl = (opts: {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	throw?: boolean;
}) => Promise<MockRequestResponse> | MockRequestResponse;

let requestUrlImpl: RequestUrlImpl = () => ({ status: 200, json: {}, text: "" });

/** Test hook: set the response `requestUrl` returns. */
export function __setRequestUrl(fn: RequestUrlImpl): void {
	requestUrlImpl = fn;
}

export function requestUrl(
	opts: Parameters<RequestUrlImpl>[0]
): Promise<MockRequestResponse> {
	return Promise.resolve(requestUrlImpl(opts));
}

export class Notice {
	constructor(_message?: string) {}
}

export const Platform = { isDesktop: true, isMacOS: true };
