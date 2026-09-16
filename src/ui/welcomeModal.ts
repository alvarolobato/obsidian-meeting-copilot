import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import { t } from "../i18n";
import { CLAUDE_CLI_MODELS, CODEX_CLI_MODELS, type EnrichCLI } from "../enrich/cliBridge";
import { cliModelPlaceholder, cliPathPlaceholder } from "../settings";
import { LOCAL_MODELS } from "../transcribe/localModels";
import { RECORD_ICON } from "./icons";
import { AGENDA_ICON } from "./agenda/MeetingAgendaView";
import { DASHBOARD_ICON } from "./dashboard/MeetingDashboardView";
import {
	ENRICH_BACKEND_OPTIONS,
	googleStepStatus,
	HELPER_DOWNLOADS_URL,
	llmStepStatus,
	type EnrichBackendId,
	modelDownloadSizeRange,
	transcriptionNeedsSetup,
	type SetupSnapshot,
	type SetupStepStatus,
} from "./welcome";

/** Which pane the welcome screen opens on. */
export type WelcomeTabId = "start" | "setup";

/**
 * Everything the welcome screen needs from the plugin, as a narrow seam so the
 * modal never reaches into `MeetingCopilotPlugin` directly (same shape as the
 * agenda/dashboard hosts).
 */
export interface WelcomeHost {
	/** Live setup state, re-read on every render. */
	snapshot(): SetupSnapshot;
	isCalendarAuthenticated(): boolean;
	/** False when no OAuth client is bundled or configured, so sign-in can't start. */
	hasGoogleCredentials(): boolean;
	/** Explains the missing credentials and opens settings where they're entered. */
	openCredentialsSettings(): void;
	isAuthenticating(): boolean;
	authenticateCalendar(): Promise<void>;
	cancelAuthenticate(): void;
	getAuthPromise(): Promise<void> | null;
	getApiBaseUrl(): string;
	getApiKey(): string;
	/** Persists the shared AI endpoint credentials. */
	setApiCredentials(baseUrl: string, apiKey: string): Promise<void>;
	/** Switches enrichment between the shared endpoint and a local CLI. */
	setEnrichBackend(backend: EnrichBackendId): Promise<void>;
	/** Per-CLI binary path override; empty means auto-detect. */
	getCliPath(cli: EnrichCLI): string;
	setCliPath(cli: EnrichCLI, path: string): Promise<void>;
	/** Per-CLI model; empty means the CLI's own default. */
	getCliModel(cli: EnrichCLI): string;
	setCliModel(cli: EnrichCLI, model: string): Promise<void>;
	/** Chat model used for enrichment through the shared endpoint. */
	getEnrichModel(): string;
	setEnrichModel(model: string): Promise<void>;
	/** Lists the endpoint's models; throws with the reason, so it doubles as a credential check. */
	loadEnrichModels(): Promise<string[]>;
	/** Opens the plugin's settings, optionally on a specific tab. */
	openSettings(tab?: "general" | "aiBackend"): void;
	/** Human-readable label for the current enrichment backend. */
	enrichBackendLabel(): string;
}

/**
 * First-install onboarding: one pane orienting the user around the ribbon
 * icons, one pane collecting the only two things that need configuring
 * (Google Calendar and an AI endpoint — transcription is on-device by
 * default, so it needs nothing), plus a short note on what the plugin
 * downloads the first time it's used.
 *
 * Re-openable at any time from the "Show welcome screen" command or the
 * General settings tab, which is also how it gets tested.
 */
export class WelcomeModal extends Modal {
	private activeTab: WelcomeTabId;
	private paneEl!: HTMLElement;
	private tabButtons = new Map<WelcomeTabId, HTMLButtonElement>();
	/** Guards the async auth callbacks below from repainting a closed modal. */
	private isOpen = false;
	/** Models last loaded from the endpoint; kept across re-renders of the pane. */
	private apiModels: string[] = [];

	constructor(
		app: App,
		private readonly host: WelcomeHost,
		initialTab: WelcomeTabId = "start"
	) {
		super(app);
		this.activeTab = initialTab;
	}

	onOpen(): void {
		const s = t().welcome;
		this.isOpen = true;
		this.modalEl.addClass("mc-welcome-modal");
		const { contentEl } = this;
		contentEl.createEl("h2", {
			text: s.title,
			cls: "mc-welcome-title",
		});

		const bar = contentEl.createDiv({ cls: "mc-welcome-tab-bar" });
		for (const id of ["start", "setup"] as const) {
			const btn = bar.createEl("button", {
				text: s.tabs[id],
				cls: "mc-welcome-tab",
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => this.selectTab(id));
			this.tabButtons.set(id, btn);
		}

		this.paneEl = contentEl.createDiv({ cls: "mc-welcome-pane" });
		this.renderActiveTab();
	}

	private selectTab(id: WelcomeTabId): void {
		if (this.activeTab === id) return;
		this.activeTab = id;
		this.renderActiveTab();
	}

	private renderActiveTab(): void {
		if (!this.isOpen) return;
		for (const [id, btn] of this.tabButtons) {
			btn.toggleClass("is-active", id === this.activeTab);
		}
		this.paneEl.empty();
		if (this.activeTab === "start") this.renderStart(this.paneEl);
		else this.renderSetup(this.paneEl);
	}

	// MARK: - "Where to start" pane

	private renderStart(el: HTMLElement): void {
		const s = t().welcome.start;
		const ribbon = t().ribbon;
		el.createEl("p", { text: s.intro, cls: "mc-welcome-intro" });

		// The real ribbon icons, rendered from the same constants the ribbon
		// registers and named with the same tooltip strings — so this can never
		// drift from what's actually in the sidebar the way a screenshot would.
		const list = el.createDiv({ cls: "mc-welcome-ribbon" });
		this.renderIconRow(list, RECORD_ICON, ribbon.toggleRecording, s.record.desc);
		this.renderIconRow(list, AGENDA_ICON, ribbon.openAgenda, s.agenda.desc);
		this.renderIconRow(
			list,
			DASHBOARD_ICON,
			ribbon.openDashboard,
			s.dashboard.desc
		);

		el.createEl("h3", { text: s.flowHeading, cls: "mc-welcome-subhead" });
		const flow = el.createDiv({ cls: "mc-welcome-flow" });
		s.flowSteps.forEach((step, i) => {
			const item = flow.createDiv({ cls: "mc-welcome-flow-step" });
			item.createSpan({
				text: String(i + 1),
				cls: "mc-welcome-flow-num",
			});
			item.createSpan({ text: step });
		});

		new Setting(el).addButton((b) =>
			b
				.setButtonText(s.next)
				.setCta()
				.onClick(() => this.selectTab("setup"))
		);
	}

	/** An icon tile with a name and a one-line description beside it. */
	private renderIconRow(
		list: HTMLElement,
		icon: string,
		name: string,
		desc: string
	): void {
		const row = list.createDiv({ cls: "mc-welcome-ribbon-row" });
		const iconEl = row.createDiv({ cls: "mc-welcome-ribbon-icon" });
		setIcon(iconEl, icon);
		const text = row.createDiv({ cls: "mc-welcome-ribbon-text" });
		text.createDiv({ text: name, cls: "mc-welcome-ribbon-name" });
		text.createDiv({ text: desc, cls: "mc-welcome-ribbon-desc" });
	}

	// MARK: - "Set up" pane

	private renderSetup(el: HTMLElement): void {
		const s = t().welcome.setup;
		const snap = this.host.snapshot();
		el.createEl("p", { text: s.intro, cls: "mc-welcome-intro" });

		this.renderGoogleStep(el, snap);
		this.renderLlmStep(el, snap);
		this.renderTranscriptionNote(el, snap);
		this.renderDownloadsNote(el);

		new Setting(el)
			.addButton((b) =>
				b
					.setButtonText(s.openSettings)
					.onClick(() => {
						this.close();
						this.host.openSettings("general");
					})
			)
			.addButton((b) =>
				b
					.setButtonText(s.done)
					.setCta()
					.onClick(() => this.close())
			);
	}

	private renderGoogleStep(el: HTMLElement, snap: SetupSnapshot): void {
		const s = t().welcome.setup;
		const step = this.createStep(el, s.google.heading, googleStepStatus(snap));
		step.createEl("p", { text: s.google.desc, cls: "mc-welcome-step-desc" });

		new Setting(step).addButton((b) => {
			if (this.host.isAuthenticating()) {
				b.setButtonText(s.google.cancel)
					.setWarning()
					.onClick(() => {
						this.host.cancelAuthenticate();
						// Looked up fresh rather than captured at click time, so
						// this settles even when a different surface (settings,
						// the agenda) started the attempt.
						void this.host
							.getAuthPromise()
							?.then(() => this.renderActiveTab());
					});
				return;
			}
			b.setButtonText(
				this.host.isCalendarAuthenticated()
					? s.google.reconnect
					: s.google.connect
			)
				.setCta()
				.onClick(() => {
					// Sign-in can't start without OAuth credentials. Close first so
					// settings doesn't open stacked on top of this modal.
					if (!this.host.hasGoogleCredentials()) {
						this.close();
						this.host.openCredentialsSettings();
						return;
					}
					void this.host
						.authenticateCalendar()
						.then(() => this.renderActiveTab());
					// Repaint immediately so the button flips to Cancel while
					// the browser consent tab is open.
					this.renderActiveTab();
				});
		});
	}

	private renderLlmStep(el: HTMLElement, snap: SetupSnapshot): void {
		const s = t().welcome.setup;
		const settings = t().settings;
		const step = this.createStep(el, s.llm.heading, llmStepStatus(snap));
		step.createEl("p", { text: s.llm.desc, cls: "mc-welcome-step-desc" });

		// The picker comes first: which backend you pick decides which fields
		// below are worth filling in, and a CLI needs no endpoint at all.
		new Setting(step).setName(s.llm.backend).addDropdown((dd) => {
			for (const option of ENRICH_BACKEND_OPTIONS) {
				dd.addOption(option, settings.enrichBackend.options[option]);
			}
			dd.setValue(snap.enrichBackend).onChange((value) => {
				void this.host
					.setEnrichBackend(value as EnrichBackendId)
					// Re-render so the fields (and the pill) match the new backend.
					.then(() => this.renderActiveTab());
			});
		});

		// A CLI authenticates itself; showing endpoint fields would invite the
		// user to fill in something that is never read.
		if (snap.enrichBackend !== "api") {
			this.renderCliFields(step, snap.enrichBackend as EnrichCLI);
			return;
		}

		new Setting(step).setName(s.llm.baseUrl).addText((text) => {
			text
				.setPlaceholder(s.llm.baseUrlPlaceholder)
				.setValue(this.host.getApiBaseUrl())
				.onChange((value) => {
					void this.host.setApiCredentials(
						value.trim(),
						this.host.getApiKey()
					);
				});
			this.refreshOnBlur(text.inputEl);
		});

		new Setting(step).setName(s.llm.apiKey).addText((text) => {
			text.inputEl.type = "password";
			text
				.setPlaceholder(s.llm.apiKeyPlaceholder)
				.setValue(this.host.getApiKey())
				.onChange((value) => {
					void this.host.setApiCredentials(
						this.host.getApiBaseUrl(),
						value.trim()
					);
				});
			this.refreshOnBlur(text.inputEl);
		});

		// Loading the models is the only honest check that the URL and key work,
		// so the same button doubles as "test these credentials".
		new Setting(step)
			.setName(settings.endpointActions.name)
			.setDesc(settings.endpointActions.desc)
			.addButton((b) =>
				b
					.setButtonText(settings.testConnection.button)
					.setCta()
					.onClick(async () => {
						if (!this.host.getApiBaseUrl().trim()) {
							new Notice(settings.testConnection.noBaseUrl);
							return;
						}
						b.setButtonText(settings.testConnection.testing);
						b.setDisabled(true);
						try {
							const models = await this.host.loadEnrichModels();
							if (!this.isOpen) return;
							this.apiModels = models;
							new Notice(
								models.length
									? settings.testConnection.success(models.length)
									: settings.testConnection.empty
							);
							this.renderActiveTab();
						} catch (e) {
							new Notice(
								settings.testConnection.failure(
									e instanceof Error ? e.message : String(e)
								)
							);
							b.setButtonText(settings.testConnection.button);
							b.setDisabled(false);
						}
					})
			);

		const model = new Setting(step).setName(settings.enrichModel.name);
		const current = this.host.getEnrichModel();
		if (this.apiModels.length > 0) {
			model.addDropdown((dd) => {
				// Keep a model the endpoint no longer lists selectable rather than
				// silently switching the user to another one.
				const options = this.apiModels.includes(current) || !current
					? this.apiModels
					: [current, ...this.apiModels];
				for (const m of options) dd.addOption(m, m);
				dd.setValue(current || options[0] || "").onChange((value) => {
					void this.host.setEnrichModel(value);
				});
			});
			return;
		}
		model.setDesc(settings.enrichModel.desc).addText((text) => {
			text
				.setPlaceholder(settings.modelCombobox.placeholderEmpty)
				.setValue(current)
				.onChange((value) => {
					void this.host.setEnrichModel(value.trim());
				});
			this.refreshOnBlur(text.inputEl);
		});
	}

	/**
	 * Re-renders the pane when a field loses focus, so the step's status pill
	 * reflects what was just typed. Deliberately not on every keystroke: that
	 * would rebuild the field being typed into and steal focus.
	 */
	private refreshOnBlur(input: HTMLElement): void {
		input.addEventListener("blur", () => {
			if (this.isOpen) this.renderActiveTab();
		});
	}

	/**
	 * Path + model for a CLI backend, mirroring the settings tab's fields (and
	 * reusing its strings) so the welcome screen is enough to finish setup.
	 * Claude and Codex have fixed model lists; OpenCode and Pi are free text,
	 * since their models are fetched live from the CLI in settings.
	 */
	private renderCliFields(step: HTMLElement, cli: EnrichCLI): void {
		const s = t().welcome.setup;
		const settings = t().settings;
		step.createEl("p", {
			text: s.llm.cliNote(settings.enrichBackend.options[cli]),
			cls: "mc-welcome-step-desc",
		});

		new Setting(step)
			.setName(settings.enrichCliPath.name)
			.setDesc(settings.enrichCliPath.desc)
			.addText((text) =>
				text
					.setPlaceholder(cliPathPlaceholder(cli, t()))
					.setValue(this.host.getCliPath(cli))
					.onChange((value) => {
						void this.host.setCliPath(cli, value.trim());
					})
			);

		const model = new Setting(step)
			.setName(settings.enrichCliModel.name)
			.setDesc(settings.enrichCliModel.desc);
		if (cli === "claude-cli" || cli === "codex-cli") {
			const models = cli === "claude-cli" ? CLAUDE_CLI_MODELS : CODEX_CLI_MODELS;
			model.addDropdown((dd) => {
				dd.addOption("", settings.enrichCliModel.defaultOption);
				for (const m of models) dd.addOption(m, m);
				dd.setValue(this.host.getCliModel(cli)).onChange((value) => {
					void this.host.setCliModel(cli, value);
				});
			});
			return;
		}
		model.addText((text) =>
			text
				.setPlaceholder(cliModelPlaceholder(cli, t()))
				.setValue(this.host.getCliModel(cli))
				.onChange((value) => {
					void this.host.setCliModel(cli, value.trim());
				})
		);
	}

	private renderTranscriptionNote(el: HTMLElement, snap: SetupSnapshot): void {
		const s = t().welcome.setup;
		const needs = transcriptionNeedsSetup(snap);
		const step = this.createStep(
			el,
			s.transcription.heading,
			needs ? "todo" : "done"
		);
		step.createEl("p", {
			text:
				snap.transcriptionBackend === "local"
					? s.transcription.descLocal
					: s.transcription.descRemote,
			cls: "mc-welcome-step-desc",
		});
	}

	/**
	 * What the plugin fetches on first use, and from where. Informational, so
	 * no status pill: nothing here is something the user has to configure,
	 * but a surprise download (or a macOS permission prompt) right after
	 * installing reads as suspicious unless it was explained up front.
	 */
	private renderDownloadsNote(el: HTMLElement): void {
		const s = t().welcome.setup.downloads;
		const settings = t().settings;
		const step = this.createStep(el, s.heading);
		step.createEl("p", { text: s.intro, cls: "mc-welcome-step-desc" });

		const list = step.createDiv({
			cls: "mc-welcome-ribbon mc-welcome-downloads",
		});
		this.renderIconRow(list, "cpu", s.helper.name, s.helper.desc);
		this.renderIconRow(list, "audio-waveform", s.vad.name, s.vad.desc);
		this.renderIconRow(
			list,
			"download",
			s.model.name(
				modelDownloadSizeRange(
					Object.values(LOCAL_MODELS).map((m) => m.sizeBytes)
				)
			),
			s.model.desc(
				settings.tabs.aiBackend,
				settings.localModelDownload.download
			)
		);

		step.createEl("p", { text: s.verified, cls: "mc-welcome-step-desc" });
		step.createEl("p", { text: s.permissions, cls: "mc-welcome-step-desc" });
		step.createEl("p", { cls: "mc-welcome-step-desc" }).createEl("a", {
			text: s.learnMore,
			href: HELPER_DOWNLOADS_URL,
		});
	}

	/**
	 * A titled block, returning the body to fill in. With a `status` it gets a
	 * pill next to the heading; without one it's a plain informational note.
	 */
	private createStep(
		el: HTMLElement,
		heading: string,
		status?: SetupStepStatus
	): HTMLElement {
		const s = t().welcome.setup;
		const step = el.createDiv({ cls: "mc-welcome-step" });
		const head = step.createDiv({ cls: "mc-welcome-step-head" });
		head.createEl("h3", { text: heading, cls: "mc-welcome-step-title" });
		if (!status) return step;
		const label =
			status === "done"
				? s.statusDone
				: status === "pending"
					? s.statusPending
					: s.statusTodo;
		head.createSpan({
			text: label,
			cls: `mc-welcome-pill is-${status}`,
		});
		return step;
	}

	onClose(): void {
		this.isOpen = false;
		this.tabButtons.clear();
		this.contentEl.empty();
	}
}
