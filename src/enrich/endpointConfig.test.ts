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

	it("rejects hosts that merely start with a loopback address", () => {
		// Would pass a `127.` prefix test, but resolves wherever its DNS says.
		expect(isLoopbackUrl("http://127.0.0.1.attacker.example/v1")).toBe(false);
		expect(isLoopbackUrl("http://127.0.0.1evil.example/v1")).toBe(false);
		expect(isLoopbackUrl("http://1270.0.0.1/v1")).toBe(false);
		expect(isLoopbackUrl("http://127.0.0.999/v1")).toBe(false);
	});

	it("accepts loopback shorthand the URL parser normalises", () => {
		expect(isLoopbackUrl("http://127.1/v1")).toBe(true);
		expect(isLoopbackUrl("http://127.0.0.2:8080/v1")).toBe(true);
	});

	it("ignores non-http(s) schemes", () => {
		expect(isLoopbackUrl("file://localhost/v1")).toBe(false);
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

	it("treats hand-edited non-string settings as unconfigured, not a crash", () => {
		const bad = {
			apiBaseUrl: "https://api.openai.com/v1",
			apiKey: "sk-test",
			enrichModel: null,
		} as unknown as Parameters<typeof apiEnrichConfigured>[0];
		expect(() => apiEnrichConfigured(bad)).not.toThrow();
		expect(apiEnrichConfigured(bad)).toBe(false);
	});

	it("does not treat a spoofed loopback host as keyless-local", () => {
		expect(
			apiEnrichConfigured({
				apiBaseUrl: "http://127.0.0.1.attacker.example/v1",
				apiKey: "",
				enrichModel: "llama3",
			})
		).toBe(false);
	});

	it("still requires a URL and a model", () => {
		expect(apiEnrichConfigured({ ...remote, apiBaseUrl: "" })).toBe(false);
		expect(apiEnrichConfigured({ ...remote, enrichModel: "" })).toBe(false);
		expect(
			apiEnrichConfigured({ apiBaseUrl: "http://localhost:11434/v1", apiKey: "", enrichModel: "" })
		).toBe(false);
	});
});
