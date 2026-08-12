/**
 * CLI bridge for enrichment: routes LLM calls to Claude Code CLI, Codex CLI,
 * OpenCode CLI, or Pi CLI instead of a direct OpenAI-compatible API endpoint.
 *
 * Pure Node.js — no Obsidian imports — so it's unit-testable in isolation.
 */

import { spawn, execSync, execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnrichCLI = "claude-cli" | "codex-cli" | "opencode-cli" | "pi-cli";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class CLINotFoundError extends Error {
	constructor(cli: EnrichCLI, searched: string) {
		super(
			`CLI not found for "${cli}". Searched: ${searched}. ` +
				`Install it (e.g. npm install -g @anthropic-ai/claude-code for claude-cli) ` +
				`or set the path in AI backend settings.`
		);
		this.name = "CLINotFoundError";
	}
}

export class CLIError extends Error {
	readonly exitCode: number | null;
	readonly stderr: string;
	constructor(message: string, exitCode: number | null, stderr: string) {
		super(message);
		this.name = "CLIError";
		this.exitCode = exitCode;
		this.stderr = stderr;
	}
}

export class CLIAbortError extends Error {
	constructor() {
		super("CLI enrichment cancelled");
		this.name = "CLIAbortError";
	}
}

// ---------------------------------------------------------------------------
// PATH construction
// ---------------------------------------------------------------------------

/**
 * Build an enhanced PATH string for the spawned process, collecting dirs from
 * version-manager env vars, hardcoded install locations, and the existing PATH.
 * When `cliPath` is provided its parent directory is prepended so a user-
 * specified binary always wins even if the bare name would resolve elsewhere.
 */
export function buildEnhancedPath(cliPath?: string): string {
	const home = os.homedir();
	const dirs: string[] = [];

	// Version-manager driven dirs (in priority order)
	const voltaHome = process.env.VOLTA_HOME;
	if (voltaHome) dirs.push(path.join(voltaHome, "bin"));

	const asdfDataDir = process.env.ASDF_DATA_DIR ?? process.env.ASDF_DIR;
	if (asdfDataDir) {
		dirs.push(path.join(asdfDataDir, "shims"));
		dirs.push(path.join(asdfDataDir, "bin"));
	}

	const fnmMultishell = process.env.FNM_MULTISHELL_PATH;
	if (fnmMultishell) dirs.push(fnmMultishell);

	const fnmDir = process.env.FNM_DIR;
	if (fnmDir) dirs.push(fnmDir);

	const nvmBin = process.env.NVM_BIN;
	if (nvmBin) {
		dirs.push(nvmBin);
	} else {
		// Resolve nvm's current default alias, if available
		try {
			const aliasFile = path.join(home, ".nvm", "alias", "default");
			const ver = fs.readFileSync(aliasFile, "utf8").trim();
			if (ver) {
				dirs.push(path.join(home, ".nvm", "versions", "node", ver, "bin"));
			}
		} catch {
			// No nvm default alias; skip
		}
	}

	// Hardcoded well-known install locations
	dirs.push(
		path.join(home, ".local", "bin"),
		path.join(home, ".bun", "bin"),
		path.join(home, ".opencode", "bin"),
		path.join(home, ".volta", "bin"),
		path.join(home, ".asdf", "shims"),
		path.join(home, ".asdf", "bin"),
		path.join(home, ".fnm"),
		path.join(home, ".npm-global", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin"
	);

	// npm global bin — common install location for all four CLIs
	try {
		const npmPrefix = execSync("npm config get prefix", {
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
		}).trim();
		if (npmPrefix && npmPrefix !== "undefined") {
			dirs.push(path.join(npmPrefix, "bin"));
		}
	} catch { /* npm not found or timed out */ }

	// Prepend the parent dir of the explicit path override so it wins
	if (cliPath && cliPath.trim()) {
		const dir = path.dirname(cliPath.trim());
		if (dir && dir !== "." && path.isAbsolute(dir)) {
			dirs.unshift(dir);
		}
	}

	// Append the inherited PATH
	const inherited = process.env.PATH ?? "";
	for (const seg of inherited.split(":")) {
		if (seg) dirs.push(seg);
	}

	// Deduplicate (first occurrence wins), drop empty segments
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const d of dirs) {
		if (d && !seen.has(d)) {
			seen.add(d);
			unique.push(d);
		}
	}

	return unique.join(":");
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

/**
 * Return the absolute path to the CLI binary, or a bare name for PATH
 * resolution when no installed copy is found. Candidate lists are walked in
 * priority order; `override`, when non-empty, is returned immediately.
 */
export function findBinary(cli: EnrichCLI, override?: string): string {
	if (override && override.trim()) return override.trim();

	const home = os.homedir();
	let candidates: string[] = [];

	switch (cli) {
		case "claude-cli": {
			candidates = [
				path.join(home, ".claude", "local", "claude"),
				path.join(home, ".local", "bin", "claude"),
				path.join(home, ".volta", "bin", "claude"),
				path.join(home, ".asdf", "shims", "claude"),
				path.join(home, ".asdf", "bin", "claude"),
				path.join(home, ".npm-global", "bin", "claude"),
				"/opt/homebrew/bin/claude",
				"/usr/local/bin/claude",
				path.join(home, "bin", "claude"),
			];
			break;
		}
		case "codex-cli":
			candidates = [
				path.join(home, ".local", "bin", "codex"),
				"/opt/homebrew/bin/codex",
				"/usr/local/bin/codex",
			];
			break;
		case "opencode-cli":
			candidates = [
				path.join(home, ".opencode", "bin", "opencode"),
				path.join(home, ".local", "bin", "opencode"),
				"/opt/homebrew/bin/opencode",
				"/usr/local/bin/opencode",
			];
			break;
		case "pi-cli":
			candidates = [
				path.join(home, ".local", "bin", "pi"),
				"/opt/homebrew/bin/pi",
				"/usr/local/bin/pi",
			];
			break;
	}

	for (const candidate of candidates) {
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			return candidate;
		} catch {
			// Not found or not executable; try next
		}
	}

	// Fall back to bare name so the enhanced-PATH spawn can find it
	const bareNames: Record<EnrichCLI, string> = {
		"claude-cli": "claude",
		"codex-cli": "codex",
		"opencode-cli": "opencode",
		"pi-cli": "pi",
	};
	return bareNames[cli];
}

// ---------------------------------------------------------------------------
// Subprocess helper
// ---------------------------------------------------------------------------

interface SpawnResult {
	stdout: string;
	stderr: string;
}

/**
 * Spawn a process, write `input` to stdin, collect stdout/stderr, and resolve
 * when the process exits cleanly. Throws on non-zero exit, ENOENT, timeout,
 * or AbortSignal cancellation.
 *
 * The process runs with `cwd` set to the system temp directory (`os.tmpdir()`)
 * so it doesn't inherit Obsidian's root `/` working directory, which confuses
 * some CLIs that walk up looking for config files.
 */
async function spawnAndCollect(
	bin: string,
	args: string[],
	input: string,
	opts: { signal?: AbortSignal; timeoutMs?: number; cli: EnrichCLI; env?: Record<string, string | undefined> }
): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: () => void;

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onAbort);
			fn();
		};

		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(bin, args, {
				stdio: ["pipe", "pipe", "pipe"],
				cwd: os.tmpdir(),
				env: opts.env ?? process.env,
			});
		} catch (e: unknown) {
			const err = e as Error & { code?: string };
			if (err.code === "ENOENT") {
				return reject(new CLINotFoundError(opts.cli, bin));
			}
			return reject(new CLIError(err instanceof Error ? err.message : String(err), null, ""));
		}

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

		const collectResult = (): SpawnResult => ({
			stdout: Buffer.concat(stdoutChunks).toString("utf8"),
			stderr: Buffer.concat(stderrChunks).toString("utf8"),
		});

		const killChild = () => {
			try {
				child.kill("SIGTERM");
			} catch {
				/* ignore */
			}
			try { child.stdin?.destroy(); } catch { /* ignore */ }
			setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					/* ignore */
				}
			}, 2000);
		};

		// Hard timeout
		if (opts.timeoutMs) {
			timer = setTimeout(() => {
				killChild();
				settle(() =>
					reject(
						new CLIError(
							`CLI timed out after ${Math.round(opts.timeoutMs! / 1000)}s`,
							null,
							""
						)
					)
				);
			}, opts.timeoutMs);
		}

		// AbortSignal cancellation
		onAbort = () => {
			killChild();
			settle(() => reject(new CLIAbortError()));
		};
		if (opts.signal) {
			if (opts.signal.aborted) {
				// Already aborted before spawn — settle immediately
				killChild();
				settle(() => reject(new CLIAbortError()));
				return;
			}
			opts.signal.addEventListener("abort", onAbort, { once: true });
		}

		child.on("error", (err: Error & { code?: string }) => {
			if (err.code === "ENOENT") {
				settle(() => reject(new CLINotFoundError(opts.cli, bin)));
			} else {
				settle(() => reject(new CLIError(err.message, null, "")));
			}
		});

		child.on("close", (code) => {
			if (settled) return; // already settled by timeout/abort
			const result = collectResult();
			if (code !== 0 && code !== null) {
				settle(() =>
					reject(
						new CLIError(
							`CLI exited with code ${code}: ${result.stderr.slice(0, 300)}`,
							code,
							result.stderr
						)
					)
				);
			} else {
				settle(() => resolve(result));
			}
		});

		// Absorb EPIPE: child may close stdin before write completes
		child.stdin?.on("error", () => { /* stdin closed by child before write completed */ });

		// Write prompt to stdin and close
		if (child.stdin && !child.stdin.destroyed) {
			child.stdin.write(input, "utf8", () => { child.stdin?.end(); });
		}
	});
}

// ---------------------------------------------------------------------------
// Per-CLI invocation
// ---------------------------------------------------------------------------

/**
 * Parse Claude Code's JSON result output.
 * Expected shape: `{"type":"result","subtype":"success","result":"<text>",...}`
 */
function parseClaudeJson(stdout: string): string {
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as Record<string, unknown>;
			if (parsed.type === "result") {
				if (parsed.subtype === "success" && !parsed.is_error) {
					const result = parsed.result;
					if (typeof result === "string" && result.trim().length > 0) {
						return result.trim();
					}
				}
				// Error subtypes (error_max_turns, error_during_execution, etc.)
				{
					const subtype = typeof parsed.subtype === "string" ? parsed.subtype : "unknown";
					throw new CLIError(
						`Claude CLI error (${subtype}): ${typeof parsed.result === "string" ? parsed.result.slice(0, 300) : "no detail"}`,
						null,
						stdout
					);
				}
			}
		} catch (e) {
			if (e instanceof CLIError) throw e;
			// Not JSON — continue scanning
		}
	}
	// No structured result found — return raw stdout if non-empty and not a JSON blob
	const raw = stdout.trim();
	if (raw && !raw.startsWith("{")) return raw;
	if (raw) throw new CLIError("Claude CLI returned an unrecognized response", null, raw);
	throw new CLIError("Claude CLI returned no usable output", null, stdout);
}

async function runClaudeCLI(
	bin: string,
	system: string,
	userPrompt: string,
	model: string | undefined,
	signal: AbortSignal | undefined,
	timeoutMs: number | undefined,
	env: Record<string, string | undefined>
): Promise<string> {
	// -p (print mode): no interactive session, just run and exit
	const args = ["-p", "--output-format", "json"];
	if (system) {
		args.push("--system-prompt", system);
	}
	if (model) {
		args.push("--model", model);
	}
	args.push("--no-session-persistence");
	// Disable tools so untrusted transcript content cannot trigger tool calls
	args.push("--tools", "");
	const result = await spawnAndCollect(bin, args, userPrompt, {
		signal,
		timeoutMs,
		cli: "claude-cli",
		env,
	});
	return parseClaudeJson(result.stdout);
}

async function runCodexCLI(
	bin: string,
	system: string,
	userPrompt: string,
	model: string | undefined,
	signal: AbortSignal | undefined,
	timeoutMs: number | undefined,
	env: Record<string, string | undefined>
): Promise<string> {
	// Write output to a temp file so we capture only the final message, not
	// any streaming or status lines that Codex may print to stdout.
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-codex-"));
	const tmpFile = path.join(tmpDir, "output.txt");
	try {
		const args = [
			"exec",
			"--skip-git-repo-check",
			"--ephemeral",
			"-s",
			"read-only",
			"--output-last-message",
			tmpFile,
		];
		if (model) {
			args.push("-m", model);
		}
		// Append "-" so Codex reads the prompt from stdin
		args.push("-");
		const combined = system ? `${system}\n\n${userPrompt}` : userPrompt;
		const result = await spawnAndCollect(bin, args, combined, {
			signal,
			timeoutMs,
			cli: "codex-cli",
			env,
		});
		// Read the output file; fall back to raw stdout if the file is missing
		let text = "";
		try {
			text = fs.readFileSync(tmpFile, "utf8").trim();
		} catch {
			text = result.stdout.trim();
		}
		if (!text) {
			throw new CLIError("Codex returned no output", null, result.stderr);
		}
		return text;
	} finally {
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
	}
}

// Note: OpenCode persists session data (including the transcript) to disk.
// There is no --no-session flag as of the current version. Users should be
// aware that enrichment sessions are stored in OpenCode's session directory.
async function runOpenCodeCLI(
	bin: string,
	system: string,
	userPrompt: string,
	model: string | undefined,
	signal: AbortSignal | undefined,
	timeoutMs: number | undefined,
	env: Record<string, string | undefined>
): Promise<string> {
	// Note: the model must be in provider/model format, e.g. "anthropic/claude-sonnet-4-5"
	const args = ["run"];
	if (model) {
		args.push("--model", model);
	}
	const combined = system ? `${system}\n\n${userPrompt}` : userPrompt;
	const result = await spawnAndCollect(bin, args, combined, {
		signal,
		timeoutMs,
		cli: "opencode-cli",
		env,
	});
	const text = result.stdout.trim();
	if (!text) {
		throw new CLIError("OpenCode CLI returned no output", null, result.stderr);
	}
	return text;
}

async function runPiCLI(
	bin: string,
	system: string,
	userPrompt: string,
	model: string | undefined,
	signal: AbortSignal | undefined,
	timeoutMs: number | undefined,
	env: Record<string, string | undefined>
): Promise<string> {
	// Pi reads the message from positional args, not stdin.
	// Large prompts exceed ARG_MAX, so write to a temp file and use @file syntax.
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-pi-"));
	const tmpFile = path.join(tmpDir, "prompt.txt");
	try {
		fs.writeFileSync(tmpFile, userPrompt, "utf8");
		const args = ["-p", "--no-session", "--no-tools"];
		if (system) args.push("--system-prompt", system);
		if (model) args.push("--model", model);
		args.push(`@${tmpFile}`);
		// stdin is unused; pass empty string
		const result = await spawnAndCollect(bin, args, "", {
			signal,
			timeoutMs,
			cli: "pi-cli",
			env,
		});
		const text = result.stdout.trim();
		if (!text) {
			throw new CLIError("Pi CLI returned no output", null, result.stderr);
		}
		return text;
	} finally {
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CLIChatParams {
	cli: EnrichCLI;
	/** Optional path override; empty or undefined = auto-detect. */
	cliPath?: string;
	/** Passed as --model when non-empty. */
	model?: string;
	system: string;
	user: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Model listing
// ---------------------------------------------------------------------------

export interface CLIModelResult {
	models: string[];
	errorKey?: "notFound" | "failed";
	errorArg?: string;
	/** True when the list is curated, not fetched live from the CLI. */
	isHardcoded?: boolean;
}

/**
 * List the models available for a given CLI backend.
 * For Claude and Codex (which have no listing command), returns a curated
 * hardcoded list. For OpenCode and Pi, runs the CLI to fetch live models.
 */
export async function loadCLIModels(
	cli: EnrichCLI,
	configuredPath?: string
): Promise<CLIModelResult> {
	const bin = findBinary(cli, configuredPath);
	const env = { ...process.env, PATH: buildEnhancedPath(configuredPath) };

	switch (cli) {
		case "claude-cli":
			return {
				models: [
					"claude-opus-5",
					"claude-sonnet-5",
					"claude-haiku-4-5",
					"claude-fable-5",
					"claude-opus-4-5",
					"claude-sonnet-4-6",
					"claude-sonnet-4-5",
					"claude-haiku-4-5-20251001",
				],
				isHardcoded: true,
			};

		case "codex-cli":
			return {
				models: ["codex-mini-latest", "o4-mini", "o3", "o3-mini", "o4"],
				isHardcoded: true,
			};

		case "opencode-cli":
			return new Promise((resolve) => {
				execFile(
					bin,
					["models"],
					{ timeout: 10000, env, cwd: os.tmpdir(), encoding: "utf8" },
					(err: (Error & { code?: string }) | null, stdout: string, stderr: string) => {
						if (err) {
							const key = err.code === "ENOENT" ? "notFound" : "failed";
							resolve({
								models: [],
								errorKey: key,
								errorArg: err.code === "ENOENT" ? bin : stderr.slice(0, 200),
							});
							return;
						}
						const models = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
						resolve({ models });
					}
				);
			});

		case "pi-cli":
			return new Promise((resolve) => {
				execFile(
					bin,
					["--list-models"],
					{ timeout: 10000, env, cwd: os.tmpdir(), encoding: "utf8" },
					(err: (Error & { code?: string }) | null, stdout: string, stderr: string) => {
						if (err) {
							const key = err.code === "ENOENT" ? "notFound" : "failed";
							resolve({
								models: [],
								errorKey: key,
								errorArg: err.code === "ENOENT" ? bin : stderr.slice(0, 200),
							});
							return;
						}
						const models = stdout
							.split("\n")
							.filter((line) => {
								const cols = line.trim().split(/\s+/);
								return (
									cols.length >= 2 &&
									cols[0] !== "provider" &&
									/^[a-z0-9_-]+$/i.test(cols[0] ?? "") &&
									/^[a-z0-9._-]+$/i.test(cols[1] ?? "")
								);
							})
							.map((line) => {
								const cols = line.trim().split(/\s+/);
								return `${cols[0] ?? ""}/${cols[1] ?? ""}`;
							});
						resolve({ models });
					}
				);
			});

		default: {
			const _: never = cli;
			return { models: [], errorKey: "failed", errorArg: `Unknown CLI: ${String(_)}` };
		}
	}
}

// ---------------------------------------------------------------------------
// Chat completion
// ---------------------------------------------------------------------------

/**
 * One-shot enrichment via a locally installed CLI tool.
 * Returns the assistant response text.
 */
export async function cliChatComplete(p: CLIChatParams): Promise<string> {
	if (p.signal?.aborted) throw new CLIAbortError();

	const bin = findBinary(p.cli, p.cliPath);
	const model = p.model && p.model.trim() ? p.model.trim() : undefined;
	const enhancedPath = buildEnhancedPath(p.cliPath);
	const env: Record<string, string | undefined> = { ...process.env, PATH: enhancedPath };

	switch (p.cli) {
		case "claude-cli":
			return runClaudeCLI(bin, p.system, p.user, model, p.signal, p.timeoutMs, env);
		case "codex-cli":
			return runCodexCLI(bin, p.system, p.user, model, p.signal, p.timeoutMs, env);
		case "opencode-cli":
			return runOpenCodeCLI(bin, p.system, p.user, model, p.signal, p.timeoutMs, env);
		case "pi-cli":
			return runPiCLI(bin, p.system, p.user, model, p.signal, p.timeoutMs, env);
		default: {
			const _exhaustive: never = p.cli;
			throw new CLIError(`Unknown CLI type: ${String(_exhaustive)}`, null, "");
		}
	}
}
