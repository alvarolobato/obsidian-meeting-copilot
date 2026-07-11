import { describe, expect, it } from "vitest";
import { inferSttApiType, STT_MODELS } from "./sttModel";

describe("inferSttApiType", () => {
	it("maps whisper names (incl. gateway ids) to the timestamped whisper family", () => {
		expect(inferSttApiType("whisper-1")).toBe("whisper-1-ts");
		expect(inferSttApiType("llm-gateway/whisper")).toBe("whisper-1-ts");
		expect(inferSttApiType("Whisper-Large")).toBe("whisper-1-ts");
	});

	it("maps mini names to the gpt-4o-mini family", () => {
		expect(inferSttApiType("gpt-4o-mini-transcribe")).toBe(
			"gpt-4o-mini-transcribe"
		);
		expect(inferSttApiType("company/gpt-4o-MINI")).toBe(
			"gpt-4o-mini-transcribe"
		);
	});

	it("defaults everything else to gpt-4o-transcribe", () => {
		expect(inferSttApiType("gpt-4o-transcribe")).toBe("gpt-4o-transcribe");
		expect(inferSttApiType("llm-gateway/transcribe")).toBe(
			"gpt-4o-transcribe"
		);
		expect(inferSttApiType("something-unknown")).toBe("gpt-4o-transcribe");
	});

	it("always returns a valid engine family", () => {
		for (const id of ["whisper-1", "x", "gpt-4o-mini", ""]) {
			expect(STT_MODELS as readonly string[]).toContain(
				inferSttApiType(id)
			);
		}
	});
});
