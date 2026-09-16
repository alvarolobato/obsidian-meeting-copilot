import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import { LOCAL_MODELS } from "../transcribe/localModels";
import {
	ENRICH_BACKEND_OPTIONS,
	googleStepStatus,
	HELPER_DOWNLOADS_URL,
	isLoopbackUrl,
	llmStepStatus,
	modelDownloadSizeRange,
	predatesWelcome,
	PRE_WELCOME_VERSION,
	setupComplete,
	shouldShowWelcome,
	transcriptionNeedsSetup,
	type SetupSnapshot,
} from "./welcome";

function snapshot(over: Partial<SetupSnapshot> = {}): SetupSnapshot {
	return {
		googleAuthenticated: false,
		googleAuthenticating: false,
		enrichBackend: "api",
		apiBaseUrl: "",
		apiKey: "",
		transcriptionBackend: "local",
		sttBaseUrl: "",
		...over,
	};
}

describe("shouldShowWelcome", () => {
	it("shows on a fresh install (no persisted version)", () => {
		expect(shouldShowWelcome({ welcomeShownVersion: "" })).toBe(true);
	});

	it("stays closed once shown", () => {
		expect(shouldShowWelcome({ welcomeShownVersion: "0.8.0" })).toBe(false);
	});

	it("does not reopen on upgrade — it is setup, not a changelog", () => {
		expect(shouldShowWelcome({ welcomeShownVersion: "0.1.0" })).toBe(false);
	});

	it("stays closed for a vault stamped as predating the welcome screen", () => {
		expect(shouldShowWelcome({ welcomeShownVersion: PRE_WELCOME_VERSION })).toBe(false);
	});
});

describe("predatesWelcome", () => {
	it("is false on a fresh install (no data.json)", () => {
		expect(predatesWelcome(null)).toBe(false);
	});

	it("is true for data.json from a build without the welcome field", () => {
		expect(predatesWelcome({ apiBaseUrl: "https://api.openai.com/v1", apiKey: "sk-x" })).toBe(true);
	});

	it("is false once the field exists, even when still empty", () => {
		expect(predatesWelcome({ welcomeShownVersion: "" })).toBe(false);
		expect(predatesWelcome({ welcomeShownVersion: "0.9.2" })).toBe(false);
	});
});

describe("googleStepStatus", () => {
	it("is todo before connecting", () => {
		expect(googleStepStatus(snapshot())).toBe("todo");
	});

	it("is pending while the consent flow is open", () => {
		expect(
			googleStepStatus(snapshot({ googleAuthenticating: true }))
		).toBe("pending");
	});

	it("is done once authenticated", () => {
		expect(googleStepStatus(snapshot({ googleAuthenticated: true }))).toBe(
			"done"
		);
	});

	it("reports pending even if a stale token is still present", () => {
		expect(
			googleStepStatus(
				snapshot({ googleAuthenticated: true, googleAuthenticating: true })
			)
		).toBe("pending");
	});
});

describe("llmStepStatus", () => {
	it("is todo for the API backend with no endpoint", () => {
		expect(llmStepStatus(snapshot())).toBe("todo");
	});

	it("is todo on a fresh install: the default URL is OpenAI's, with no key", () => {
		expect(DEFAULT_SETTINGS.apiKey).toBe("");
		expect(
			llmStepStatus(
				snapshot({
					apiBaseUrl: DEFAULT_SETTINGS.apiBaseUrl,
					apiKey: DEFAULT_SETTINGS.apiKey,
				})
			)
		).toBe("todo");
	});

	it("is done for a remote endpoint once it has a key", () => {
		expect(
			llmStepStatus(
				snapshot({ apiBaseUrl: "https://api.openai.com/v1", apiKey: "sk-test" })
			)
		).toBe("done");
	});

	it("ignores a whitespace-only key", () => {
		expect(
			llmStepStatus(snapshot({ apiBaseUrl: "https://api.openai.com/v1", apiKey: "  " }))
		).toBe("todo");
	});

	it("ignores a whitespace-only base URL", () => {
		expect(llmStepStatus(snapshot({ apiBaseUrl: "   " }))).toBe("todo");
	});

	it("does not require an API key on this machine — local servers have none", () => {
		expect(
			llmStepStatus(snapshot({ apiBaseUrl: "http://localhost:11434/v1" }))
		).toBe("done");
		expect(llmStepStatus(snapshot({ apiBaseUrl: "http://127.0.0.1:1234/v1" }))).toBe("done");
	});

	it("is done for a CLI backend, which needs no endpoint from us", () => {
		expect(llmStepStatus(snapshot({ enrichBackend: "claude-cli" }))).toBe(
			"done"
		);
	});
});

describe("transcriptionNeedsSetup", () => {
	it("is false for the on-device default", () => {
		expect(transcriptionNeedsSetup(snapshot())).toBe(false);
	});

	it("is true for remote with no endpoint anywhere", () => {
		expect(
			transcriptionNeedsSetup(snapshot({ transcriptionBackend: "remote" }))
		).toBe(true);
	});

	it("is false when the shared endpoint can serve it", () => {
		expect(
			transcriptionNeedsSetup(
				snapshot({
					transcriptionBackend: "remote",
					apiBaseUrl: "https://api.openai.com/v1",
				})
			)
		).toBe(false);
	});

	it("is false when a dedicated STT endpoint is set", () => {
		expect(
			transcriptionNeedsSetup(
				snapshot({
					transcriptionBackend: "remote",
					sttBaseUrl: "https://stt.example.com/v1",
				})
			)
		).toBe(false);
	});
});

describe("setupComplete", () => {
	it("is false until Google is connected", () => {
		expect(
			setupComplete(snapshot({ apiBaseUrl: "https://api.openai.com/v1" }))
		).toBe(false);
	});

	it("is true with Google connected and an endpoint with a key", () => {
		expect(
			setupComplete(
				snapshot({
					googleAuthenticated: true,
					apiBaseUrl: "https://api.openai.com/v1", apiKey: "sk-test",
				})
			)
		).toBe(true);
	});

	it("is false when remote transcription has nowhere to go", () => {
		expect(
			setupComplete(
				snapshot({
					googleAuthenticated: true,
					enrichBackend: "claude-cli",
					transcriptionBackend: "remote",
				})
			)
		).toBe(false);
	});
});

describe("modelDownloadSizeRange", () => {
	it("spans smallest to largest, sharing the unit", () => {
		expect(modelDownloadSizeRange([574_041_195, 190_085_487, 539_212_467])).toBe(
			"190–574 MB"
		);
	});

	it("keeps both units when the range crosses into GB", () => {
		expect(modelDownloadSizeRange([190_085_487, 1_500_000_000])).toBe(
			"190 MB–1.5 GB"
		);
	});

	it("collapses to a single size when every model is the same size", () => {
		expect(modelDownloadSizeRange([190_085_487, 190_085_487])).toBe("190 MB");
	});

	it("is empty with no models", () => {
		expect(modelDownloadSizeRange([])).toBe("");
	});

	it("produces a real range from the shipped registry", () => {
		const sizes = Object.values(LOCAL_MODELS).map((m) => m.sizeBytes);
		expect(modelDownloadSizeRange(sizes)).toMatch(/^\d+–\d+ MB$/);
	});
});

describe("HELPER_DOWNLOADS_URL", () => {
	it("points at the README's helper-downloads section on GitHub", () => {
		expect(HELPER_DOWNLOADS_URL).toBe(
			"https://github.com/alvarolobato/obsidian-meeting-copilot#helper-downloads"
		);
	});
});

describe("isLoopbackUrl", () => {
	it("recognizes this machine", () => {
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

describe("ENRICH_BACKEND_OPTIONS", () => {
	it("offers the endpoint plus every CLI the settings tab knows", () => {
		expect([...ENRICH_BACKEND_OPTIONS]).toEqual([
			"api",
			...Object.keys(DEFAULT_SETTINGS.enrichCliPaths),
		]);
	});

	it("lists the endpoint first, as the default backend", () => {
		expect(ENRICH_BACKEND_OPTIONS[0]).toBe("api");
		expect(DEFAULT_SETTINGS.enrichBackend).toBe("api");
	});
});
