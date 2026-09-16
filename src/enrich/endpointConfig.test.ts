import { describe, expect, it } from "vitest";
import { apiEnrichConfigured, isLoopbackUrl } from "./endpointConfig";

describe("isLoopbackUrl", () => {
	it("recognizes endpoints on this machine", () => {
		expect(isLoopbackUrl("http://localhost:11434/v1")).toBe(true);
		expect(isLoopbackUrl("http://127.0.0.1:1234")).toBe(true);
		expect(isLoopbackUrl("http://[::1]:8080/v1")).toBe(true);
		expect(isLoopbackUrl("http://llm.localhost/v1")).toBe(true);
	});

	it("rejects remote hosts and unparseable input", () => {
		expect(isLoopbackUrl("https://api.openai.com/v1")).toBe(false);
		expect(isLoopbackUrl("https://localhost.example.com/v1")).toBe(false);
		expect(isLoopbackUrl("not a url")).toBe(false);
	});
});

describe("apiEnrichConfigured", () => {
	const remote = { apiBaseUrl: "https://api.openai.com/v1", apiKey: "sk-test", enrichModel: "gpt-4o" };

	it("accepts a remote endpoint with a key and a model", () => {
		expect(apiEnrichConfigured(remote)).toBe(true);
	});

	it("requires a key for a remote endpoint", () => {
		expect(apiEnrichConfigured({ ...remote, apiKey: "" })).toBe(false);
		expect(apiEnrichConfigured({ ...remote, apiKey: "  " })).toBe(false);
	});

	it("allows a local server to go keyless", () => {
		expect(
			apiEnrichConfigured({ apiBaseUrl: "http://localhost:11434/v1", apiKey: "", enrichModel: "llama3" })
		).toBe(true);
	});

	it("still requires a URL and a model", () => {
		expect(apiEnrichConfigured({ ...remote, apiBaseUrl: "" })).toBe(false);
		expect(apiEnrichConfigured({ ...remote, enrichModel: "" })).toBe(false);
		expect(
			apiEnrichConfigured({ apiBaseUrl: "http://localhost:11434/v1", apiKey: "", enrichModel: "" })
		).toBe(false);
	});
});
