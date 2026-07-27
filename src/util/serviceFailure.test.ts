import { describe, expect, it } from "vitest";
import { isServiceFailure } from "./serviceFailure";

describe("isServiceFailure", () => {
	it("treats timeouts as service failures", () => {
		expect(
			isServiceFailure(new Error("LLM request timed out after 120s"))
		).toBe(true);
		const named = new Error("Request timed out after 60s");
		named.name = "RequestTimeoutError";
		expect(isServiceFailure(named)).toBe(true);
	});

	it("treats network errors as service failures", () => {
		expect(isServiceFailure(new Error("Failed to fetch"))).toBe(true);
		expect(isServiceFailure(new Error("net::ERR_CONNECTION_REFUSED"))).toBe(
			true
		);
		expect(isServiceFailure(new Error("ECONNRESET"))).toBe(true);
	});

	it("treats 5xx / 401 / 403 / 429 / 408 as service failures", () => {
		expect(
			isServiceFailure(new Error("LLM request failed (502): Bad Gateway"))
		).toBe(true);
		expect(isServiceFailure(new Error("API Error 503: unavailable"))).toBe(
			true
		);
		expect(isServiceFailure(new Error("LLM request failed (401):"))).toBe(
			true
		);
		expect(isServiceFailure(new Error("LLM request failed (429):"))).toBe(
			true
		);
	});

	it("does not treat user cancel as a service failure", () => {
		const abort = new Error("LLM request cancelled");
		abort.name = "ChatAbortError";
		expect(isServiceFailure(abort)).toBe(false);
		expect(isServiceFailure(new Error("Request cancelled by user"))).toBe(
			false
		);
	});

	it("does not treat ordinary 400 / empty content as service failures", () => {
		expect(
			isServiceFailure(new Error("LLM request failed (400): bad request"))
		).toBe(false);
		expect(
			isServiceFailure(
				new Error("LLM request failed (400): invalid timeout value")
			)
		).toBe(false);
		expect(isServiceFailure(new Error("LLM returned no content"))).toBe(
			false
		);
	});

	it("treats EnrichTimeoutError / RequestTimeoutError by name", () => {
		const enrich = new Error("LLM request timed out after 120s");
		enrich.name = "EnrichTimeoutError";
		expect(isServiceFailure(enrich)).toBe(true);
		const req = new Error("Request timed out after 60s");
		req.name = "RequestTimeoutError";
		expect(isServiceFailure(req)).toBe(true);
	});

	it("lets HTTP status win over a timeout substring in the body", () => {
		expect(
			isServiceFailure(
				new Error("LLM request failed (422): parameter timeout invalid")
			)
		).toBe(false);
		expect(
			isServiceFailure(
				new Error("API Error 502: upstream timed out")
			)
		).toBe(true);
	});

	it("does not treat a bare 'timeout' word as a service failure", () => {
		expect(isServiceFailure(new Error("invalid timeout value"))).toBe(
			false
		);
	});
});
