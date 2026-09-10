import { App, Modal, Setting, setIcon } from "obsidian";
import { t } from "../i18n";
import { RECORD_ICON } from "./icons";
import { AGENDA_ICON } from "./agenda/MeetingAgendaView";
import { DASHBOARD_ICON } from "./dashboard/MeetingDashboardView";
import {
	googleStepStatus,
	llmStepStatus,
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
	isAuthenticating(): boolean;
	authenticateCalendar(): Promise<void>;
	cancelAuthenticate(): void;
	getAuthPromise(): Promise<void> | null;
	getApiBaseUrl(): string;
	getApiKey(): string;
	/** Persists the shared AI endpoint credentials. */
	setApiCredentials(baseUrl: string, apiKey: string): Promise<void>;
	/** Opens the plugin's settings, optionally on a specific tab. */
	openSettings(tab?: "general" | "aiBackend"): void;
	/** Human-readable label for the current enrichment backend. */
	enrichBackendLabel(): string;
}

/**
 * First-install onboarding: one pane orienting the user around the ribbon
 * icons, one pane collecting the only two things that need configuring
 * (Google Calendar and an AI endpoint — transcription is on-device by
 * default, so it needs nothing).
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
		el.createEl("p", { text: s.intro, cls: "mc-welcome-intro" });

		// The real ribbon icons, rendered from the same constants the ribbon
		// registers — so this can never drift from what's actually in the
		// sidebar the way a screenshot would.
		const list = el.createDiv({ cls: "mc-welcome-ribbon" });
		const rows: Array<[string, { name: string; desc: string }]> = [
			[RECORD_ICON, s.record],
			[AGENDA_ICON, s.agenda],
			[DASHBOARD_ICON, s.dashboard],
		];
		for (const [icon, copy] of rows) {
			const row = list.createDiv({ cls: "mc-welcome-ribbon-row" });
			const iconEl = row.createDiv({ cls: "mc-welcome-ribbon-icon" });
			setIcon(iconEl, icon);
			const text = row.createDiv({ cls: "mc-welcome-ribbon-text" });
			text.createEl("div", {
				text: copy.name,
				cls: "mc-welcome-ribbon-name",
			});
			text.createEl("div", {
				text: copy.desc,
				cls: "mc-welcome-ribbon-desc",
			});
		}

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

	// MARK: - "Set up" pane

	private renderSetup(el: HTMLElement): void {
		const s = t().welcome.setup;
		const snap = this.host.snapshot();
		el.createEl("p", { text: s.intro, cls: "mc-welcome-intro" });

		this.renderGoogleStep(el, snap);
		this.renderLlmStep(el, snap);
		this.renderTranscriptionNote(el, snap);

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
		const step = this.createStep(el, s.llm.heading, llmStepStatus(snap));

		// A CLI backend authenticates itself; showing endpoint fields would
		// invite the user to fill in something that is never read.
		if (snap.enrichBackend !== "api") {
			step.createEl("p", {
				text: s.llm.cliNote(this.host.enrichBackendLabel()),
				cls: "mc-welcome-step-desc",
			});
			return;
		}

		step.createEl("p", { text: s.llm.desc, cls: "mc-welcome-step-desc" });

		new Setting(step).setName(s.llm.baseUrl).addText((text) =>
			text
				.setPlaceholder(s.llm.baseUrlPlaceholder)
				.setValue(this.host.getApiBaseUrl())
				.onChange((value) => {
					void this.host.setApiCredentials(
						value.trim(),
						this.host.getApiKey()
					);
				})
		);

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
		});
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

	/** A titled block with a status pill, returning the body to fill in. */
	private createStep(
		el: HTMLElement,
		heading: string,
		status: SetupStepStatus
	): HTMLElement {
		const s = t().welcome.setup;
		const step = el.createDiv({ cls: "mc-welcome-step" });
		const head = step.createDiv({ cls: "mc-welcome-step-head" });
		head.createEl("h3", { text: heading, cls: "mc-welcome-step-title" });
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
