import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { t } from "../../i18n";
import type { MeetingDirection } from "../../notes/dashboardMeetings";

export const VIEW_TYPE_DASHBOARD = "meeting-copilot-dashboard";
export const DASHBOARD_ICON = "layout-dashboard";

/**
 * Everything the dashboard view needs from the plugin. Every render method
 * here is unchanged from when it rendered into a note's code block — this
 * view only owns the section shells (title + container) and registers each
 * container with {@link trackDashboardBlock} so the plugin's existing
 * debounced auto-refresh (any vault/pipeline change) keeps it live, the same
 * way the old note-embedded blocks worked.
 */
export interface DashboardViewHost {
	renderAttention(el: HTMLElement): void;
	renderMeetingsSection(
		el: HTMLElement,
		direction: MeetingDirection,
		page?: number,
		force?: boolean
	): Promise<void>;
	renderActionItems(el: HTMLElement, page?: number, force?: boolean): Promise<void>;
	renderFollowUps(el: HTMLElement, page?: number, force?: boolean): Promise<void>;
	trackDashboardBlock(el: HTMLElement, rerender: () => void): void;
	openSettings(): void;
}

/**
 * The meetings dashboard: needs-attention, upcoming/past meetings, open
 * action items, and follow-ups. Opened as a plain workspace tab — no vault
 * file backs it (see AGENTS.md / the PR description for why this replaced
 * the old "Create/update meetings dashboard" note).
 */
export class MeetingDashboardView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private host: DashboardViewHost
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DASHBOARD;
	}

	getDisplayText(): string {
		return t().dashboard.title;
	}

	getIcon(): string {
		return DASHBOARD_ICON;
	}

	async onOpen(): Promise<void> {
		const d = t().dashboard;
		const { contentEl } = this;
		contentEl.empty();

		const outer = contentEl.createDiv({ cls: "mc-cal" });
		const root = outer.createDiv({ cls: "mc-cal-inner mc-dash" });

		const header = root.createDiv({ cls: "mc-cal-head" });
		const top = header.createDiv({ cls: "mc-cal-head-top" });
		top.createDiv({ cls: "mc-cal-head-title", text: d.title });
		const controls = top.createDiv({ cls: "mc-cal-head-controls" });
		const settingsBtn = controls.createEl("button", {
			cls: "mc-cal-icon-btn",
			attr: { "aria-label": t().agenda.openSettings },
		});
		setIcon(settingsBtn, "settings-2");
		settingsBtn.addEventListener("click", () => this.host.openSettings());

		this.renderSection(root, d.sections.attention, (body) => {
			this.host.renderAttention(body);
			this.host.trackDashboardBlock(body, () => this.host.renderAttention(body));
		});

		this.renderSection(root, d.sections.upcoming, (body) => {
			void this.host.renderMeetingsSection(body, "upcoming");
			this.host.trackDashboardBlock(body, () =>
				void this.host.renderMeetingsSection(body, "upcoming", this.blockPage(body))
			);
		});

		this.renderSection(root, d.sections.past, (body) => {
			void this.host.renderMeetingsSection(body, "past");
			this.host.trackDashboardBlock(body, () =>
				void this.host.renderMeetingsSection(body, "past", this.blockPage(body))
			);
		});

		this.renderSection(root, d.sections.actions, (body) => {
			void this.host.renderActionItems(body);
			this.host.trackDashboardBlock(body, () =>
				void this.host.renderActionItems(body, this.blockPage(body), true)
			);
		});

		this.renderSection(root, d.sections.followups, (body) => {
			void this.host.renderFollowUps(body);
			this.host.trackDashboardBlock(body, () =>
				void this.host.renderFollowUps(body, this.blockPage(body), true)
			);
		});
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private renderSection(
		parent: HTMLElement,
		title: string,
		body: (el: HTMLElement) => void
	): void {
		const section = parent.createDiv({ cls: "mc-dash-section" });
		section.createEl("h3", { cls: "mc-dash-section-title", text: title });
		body(section.createDiv({ cls: "mc-dash-section-body" }));
	}

	/** The block's last-rendered (1-based) page, stashed on the element by the
	 * plugin's own render methods — mirrors `SystemRecordingPlugin.blockPage`. */
	private blockPage(el: HTMLElement): number {
		const n = Number.parseInt(el.dataset.mcPage ?? "", 10);
		return Number.isFinite(n) && n > 0 ? n : 1;
	}
}
