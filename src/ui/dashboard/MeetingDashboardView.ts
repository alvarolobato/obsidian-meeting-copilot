import { ItemView, WorkspaceLeaf } from "obsidian";
import { t } from "../../i18n";

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
	renderPastMeetings(el: HTMLElement, page?: number, force?: boolean): Promise<void>;
	renderActionItems(el: HTMLElement, page?: number, force?: boolean): Promise<void>;
	renderFollowUps(el: HTMLElement, page?: number, force?: boolean): Promise<void>;
	/**
	 * The "Notes with issues" catch-all — meeting notes that still need
	 * something (a missing transcript/summary, a truncated transcript, or a
	 * folder/tag mismatch) but have aged out of "Past meetings"'s short
	 * recency window. Deliberately NOT tracked by {@link trackDashboardBlock}:
	 * that fires on every dashboard-wide change (a ticked checkbox, a page
	 * turn elsewhere), and this section's scan is a full vault walk — too
	 * heavy to redo on every one of those. Instead it's registered via
	 * {@link trackNoteIssuesBlock}, refreshed only by the narrower set of
	 * events that can actually change its contents (a transcribe/enrich job
	 * finishing, or a metadata fix applied elsewhere).
	 */
	renderNoteIssues(el: HTMLElement, force?: boolean): Promise<void>;
	trackDashboardBlock(el: HTMLElement, rerender: () => void): void;
	trackNoteIssuesBlock(el: HTMLElement): void;
	openSettings(): void;
}

/**
 * The meetings dashboard: past meetings (with anything that still needs
 * attention highlighted inline), open action items, and follow-ups. Opened as
 * a plain workspace tab — no vault file backs it (see AGENTS.md / the PR
 * description for why this replaced the old "Create/update meetings
 * dashboard" note).
 */
export class MeetingDashboardView extends ItemView {
	/** The native header's settings button, torn down on close so a re-open never doubles it up. */
	private settingsAction: HTMLElement | null = null;

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

		// The tab title and the pane's own header already show the view's
		// name (getDisplayText()) — no need for a third, in-content title.
		// The settings button lives in that same native header instead of a
		// custom title row.
		this.settingsAction?.remove();
		this.settingsAction = this.addAction(
			"settings-2",
			t().agenda.openSettings,
			() => this.host.openSettings()
		);

		const outer = contentEl.createDiv({ cls: "mc-cal" });
		const root = outer.createDiv({ cls: "mc-cal-inner mc-dash" });

		this.renderSection(root, d.sections.past, (body) => {
			void this.host.renderPastMeetings(body);
			this.host.trackDashboardBlock(body, () =>
				void this.host.renderPastMeetings(body, this.blockPage(body))
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

		// Its own card, not `renderSection` — it builds its own collapsible
		// header (title + count + refresh) rather than a static title, so it
		// gets the bare section div, not a pre-titled body. `force: true` only
		// for this first paint (the cache may be stale from a previous
		// dashboard open in the same session); after that it's refreshed only
		// via `trackNoteIssuesBlock` (see the host interface doc comment).
		const issuesSection = root.createDiv({ cls: "mc-dash-section" });
		void this.host.renderNoteIssues(issuesSection, true);
		this.host.trackNoteIssuesBlock(issuesSection);
	}

	async onClose(): Promise<void> {
		this.settingsAction?.remove();
		this.settingsAction = null;
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
