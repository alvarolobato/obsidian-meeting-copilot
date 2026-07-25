import { describe, it, expect } from "vitest";

// Re-implement the encode/decode pair here to test the algorithm directly,
// independently of the build-time injection (which vitest stubs with []).
function xorEncode(str: string, key: number[]): number[] {
	const bytes = Array.from(new TextEncoder().encode(str));
	return bytes.map((b, i) => b ^ (key[i % key.length] ?? 0));
}

function xorDecode(encoded: number[], key: number[]): string {
	if (!key.length) return "";
	return encoded
		.map((b, i) => b ^ (key[i % key.length] ?? 0))
		.map((b) => String.fromCharCode(b))
		.join("");
}

describe("XOR credential obfuscation", () => {
	const key = [0x3f, 0xa1, 0x72, 0x0c, 0x5d, 0x88, 0x14, 0xfe];

	it("round-trips a Google client ID", () => {
		const id = "742472822336-abc.apps.googleusercontent.com";
		expect(xorDecode(xorEncode(id, key), key)).toBe(id);
	});

	it("round-trips a Google client secret", () => {
		const secret = "GOCSPX-ExAmPlEsEcReT";
		expect(xorDecode(xorEncode(secret, key), key)).toBe(secret);
	});

	it("returns empty string when key is empty", () => {
		expect(xorDecode([0x41, 0x42], [])).toBe("");
	});

	it("returns empty string when encoded is empty", () => {
		expect(xorDecode([], key)).toBe("");
	});

	it("produces different ciphertext for different keys", () => {
		const text = "test-credential";
		const key2 = key.map((b) => b ^ 0xff);
		expect(xorEncode(text, key)).not.toEqual(xorEncode(text, key2));
	});
});
