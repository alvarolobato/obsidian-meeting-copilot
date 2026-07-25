import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	resolve: {
		alias: {
			// Obsidian has no runtime entry point; stub the bits tests need.
			obsidian: fileURLToPath(
				new URL("./test/obsidian-mock.ts", import.meta.url)
			),
		},
	},
	define: {
		// Mirror what the esbuild credentials plugin injects at build time.
		// Tests use empty arrays so credentials.ts resolves to empty strings.
		__MC_GOOGLE_CLIENT_ID_XOR__: "[]",
		__MC_GOOGLE_CLIENT_SECRET_XOR__: "[]",
		__MC_GOOGLE_XOR_KEY__: "[]",
	},
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
});
