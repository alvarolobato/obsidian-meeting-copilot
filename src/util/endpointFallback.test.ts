import { describe, expect, it } from "vitest";
import {
	fallbackEndpoint,
	isFallbackEndpointConfigured,
	primaryEndpoint,
} from "./endpointFallback";

const base = {
	apiBaseUrl: "https://primary.example/v1",
	apiKey: "pk",
	sttModel: "gpt-4o-transcribe",
	sttApiType: "gpt-4o-transcribe" as const,
	enrichModel: "gpt-4o",
	fallbackApiBaseUrl: "",
	fallbackApiKey: "",
	fallbackSttModel: "",
	fallbackEnrichModel: "",
};

describe("endpointFallback", () => {
	it("reports unconfigured when URL or key is empty", () => {
		expect(isFallbackEndpointConfigured(base)).toBe(false);
		expect(
			isFallbackEndpointConfigured({
				...base,
				fallbackApiBaseUrl: "https://fb.example/v1",
			})
		).toBe(false);
		expect(
			isFallbackEndpointConfigured({
				...base,
				fallbackApiBaseUrl: "https://fb.example/v1",
				fallbackApiKey: "fk",
			})
		).toBe(true);
	});

	it("inherits primary models when fallback model fields are empty", () => {
		const fb = fallbackEndpoint({
			...base,
			fallbackApiBaseUrl: "https://fb.example/v1",
			fallbackApiKey: "fk",
		});
		expect(fb).toEqual({
			baseUrl: "https://fb.example/v1",
			apiKey: "fk",
			sttModel: "gpt-4o-transcribe",
			sttApiType: "gpt-4o-transcribe",
			enrichModel: "gpt-4o",
		});
	});

	it("keeps primary sttApiType when inheriting an opaque primary STT model", () => {
		// Gateway ids often don't hint the family; the user sets sttApiType
		// explicitly. Re-inferring would wrong-route the fallback.
		const fb = fallbackEndpoint({
			...base,
			sttModel: "company/asr-v2",
			sttApiType: "whisper-1-ts",
			fallbackApiBaseUrl: "https://fb.example/v1",
			fallbackApiKey: "fk",
			fallbackSttModel: "",
		});
		expect(fb?.sttModel).toBe("company/asr-v2");
		expect(fb?.sttApiType).toBe("whisper-1-ts");
	});

	it("uses distinct fallback models and infers STT family from the name", () => {
		const fb = fallbackEndpoint({
			...base,
			fallbackApiBaseUrl: "https://fb.example/v1",
			fallbackApiKey: "fk",
			fallbackSttModel: "gateway/whisper-large",
			fallbackEnrichModel: "claude-sonnet",
		});
		expect(fb?.sttModel).toBe("gateway/whisper-large");
		expect(fb?.sttApiType).toBe("whisper-1-ts");
		expect(fb?.enrichModel).toBe("claude-sonnet");
	});

	it("builds the primary endpoint from settings", () => {
		expect(primaryEndpoint(base)).toEqual({
			baseUrl: "https://primary.example/v1",
			apiKey: "pk",
			sttModel: "gpt-4o-transcribe",
			sttApiType: "gpt-4o-transcribe",
			enrichModel: "gpt-4o",
		});
	});
});
