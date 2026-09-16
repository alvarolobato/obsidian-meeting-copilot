import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import { LOCAL_MODELS } from "../transcribe/localModels";
import {
	ENRICH_BACKEND_OPTIONS,
	googleStepStatus,
	HELPER_DOWNLOADS_URL,
	llmStepStatus,
	modelDownloadSizeRange,
	modelLoadOutcome,
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
		enrichModel: "",
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
	const ready = { apiBaseUrl: "https://api.openai.com/v1", apiKey: "sk-test", enrichModel: "gpt-4o" };

	it("is done once the endpoint has a URL, key, and model", () => {
		expect(llmStepStatus(snapshot(ready))).toBe("done");
	});

	it("is todo on a fresh install: the default URL has no key or model", () => {
		expect(DEFAULT_SETTINGS.apiKey).toBe("");
		expect(
			llmStepStatus(
				snapshot({
					apiBaseUrl: DEFAULT_SETTINGS.apiBaseUrl,
					apiKey: DEFAULT_SETTINGS.apiKey,
					enrichModel: DEFAULT_SETTINGS.enrichModel,
				})
			)
		).toBe("todo");
	});

	it("is todo while any one of URL, key, or model is missing", () => {
		expect(llmStepStatus(snapshot({ ...ready, apiBaseUrl: "" }))).toBe("todo");
		expect(llmStepStatus(snapshot({ ...ready, apiKey: "" }))).toBe("todo");
		expect(llmStepStatus(snapshot({ ...ready, enrichModel: "" }))).toBe("todo");
	});

	it("is done for a keyless local server, which enrichment also accepts", () => {
		expect(
			llmStepStatus(
				snapshot({ apiBaseUrl: "http://localhost:11434/v1", apiKey: "", enrichModel: "llama3" })
			)
		).toBe("done");
	});

	it("ignores whitespace-only values", () => {
		expect(llmStepStatus(snapshot({ ...ready, apiKey: "   " }))).toBe("todo");
		expect(llmStepStatus(snapshot({ ...ready, enrichModel: "  " }))).toBe("todo");
	});

	it("is done for a CLI backend, which needs no endpoint from us", () => {
		expect(llmStepStatus(snapshot({ enrichBackend: "claude-cli" }))).toBe("done");
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
					apiBaseUrl: "https://api.openai.com/v1", apiKey: "sk-test", enrichModel: "gpt-4o",
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

describe("modelLoadOutcome", () => {
	const live = {
		isOpen: true,
		seq: 2,
		currentSeq: 2,
		asked: "url\u0000key",
		current: "url\u0000key",
		backend: "api",
		rowAttached: true,
	};

	it("reports for the load the user is waiting on", () => {
		expect(modelLoadOutcome(live)).toBe("report");
	});

	it("ignores a load that finished after the modal closed", () => {
		expect(modelLoadOutcome({ ...live, isOpen: false })).toBe("ignore");
	});

	it("ignores a load superseded by a newer one", () => {
		expect(modelLoadOutcome({ ...live, seq: 1, currentSeq: 2 })).toBe("ignore");
	});

	it("frees the button when the credentials changed mid-flight", () => {
		expect(modelLoadOutcome({ ...live, current: "other\u0000key" })).toBe("reenable");
	});

	it("stays silent when the pane moved to a CLI backend", () => {
		expect(modelLoadOutcome({ ...live, backend: "claude-cli" })).toBe("ignore");
	});

	it("stays silent when its row was detached by a re-render", () => {
		expect(modelLoadOutcome({ ...live, rowAttached: false })).toBe("ignore");
	});

	it("prefers ignore over reenable once superseded, so the newer load keeps the button", () => {
		expect(
			modelLoadOutcome({ ...live, seq: 1, currentSeq: 2, current: "other\u0000key" })
		).toBe("ignore");
	});
});
