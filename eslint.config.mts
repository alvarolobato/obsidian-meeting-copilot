import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Unit tests and their stand-ins run under Node (vitest), not in an
		// Obsidian window: the popout-window rules don't apply, and the mock
		// re-exports the real `moment` package that Obsidian bundles at runtime.
		files: ["**/*.test.ts", "test/**/*.ts"],
		rules: {
			"obsidianmd/prefer-window-timers": "off",
			"obsidianmd/no-global-this": "off",
			"@typescript-eslint/no-restricted-imports": "off",
			"import/no-extraneous-dependencies": "off",
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.mts",
		"deploy-local.mjs",
		"scripts/**",
		// Agent worktrees nested in the main checkout.
		".claude/**",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"vitest.config.ts",
		// Vendored transcription engine (upstream MIT, kept pristine except the
		// documented endpoint patches). Not subject to our lint rules.
		"src/transcribe/vendor/**",
	]),
);
