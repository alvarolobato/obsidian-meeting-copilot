// Build-time injected by the esbuild credentials plugin (esbuild.config.mjs).
// Each constant is XOR-encoded with a per-build random key so plain strings
// don't appear in main.js. The key is also baked in — this is obfuscation,
// not encryption — but it stops naive `strings`/grep from surfacing credentials.
declare const __MC_GOOGLE_CLIENT_ID_XOR__: number[];
declare const __MC_GOOGLE_CLIENT_SECRET_XOR__: number[];
declare const __MC_GOOGLE_XOR_KEY__: number[];

function xorDecode(encoded: number[], key: number[]): string {
	// An empty key means the build injected nothing — return empty rather than
	// accidentally producing plaintext (XOR with no key is identity).
	if (!key.length) return "";
	return encoded
		.map((b, i) => b ^ (key[i % key.length] ?? 0))
		.map((b) => String.fromCharCode(b))
		.join("");
}

const _key = __MC_GOOGLE_XOR_KEY__;

export const BUNDLED_CLIENT_ID: string =
	__MC_GOOGLE_CLIENT_ID_XOR__.length && _key.length
		? xorDecode(__MC_GOOGLE_CLIENT_ID_XOR__, _key)
		: "";

export const BUNDLED_CLIENT_SECRET: string =
	__MC_GOOGLE_CLIENT_SECRET_XOR__.length && _key.length
		? xorDecode(__MC_GOOGLE_CLIENT_SECRET_XOR__, _key)
		: "";
