import { describe, expect, it } from "vitest";
import {
	googleStepStatus,
	llmStepStatus,
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

	it("is done for the API backend once a base URL is set", () => {
		expect(
			llmStepStatus(snapshot({ apiBaseUrl: "https://api.openai.com/v1" }))
		).toBe("done");
	});

	it("ignores a whitespace-only base URL", () => {
		expect(llmStepStatus(snapshot({ apiBaseUrl: "   " }))).toBe("todo");
	});

	it("does not require an API key — local servers have none", () => {
		expect(
			llmStepStatus(snapshot({ apiBaseUrl: "http://localhost:11434/v1" }))
		).toBe("done");
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

	it("is true with Google connected and an endpoint set", () => {
		expect(
			setupComplete(
				snapshot({
					googleAuthenticated: true,
					apiBaseUrl: "https://api.openai.com/v1",
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
