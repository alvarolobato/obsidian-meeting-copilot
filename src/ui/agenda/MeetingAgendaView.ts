import { ItemView, WorkspaceLeaf, moment, setIcon } from "obsidian";
import { t } from "../../i18n";
import type { TypedEventBus } from "../../util/events";
import type { AgendaMeeting } from "./agendaModel";
import { renderStatusHeader } from "./components/statusHeader";
import { renderCurrentMeeting } from "./components/currentMeeting";
import { renderMeetingRow, RowHandlers } from "./components/meetingRow";

export const VIEW_TYPE_AGENDA = "meeting-copilot-agenda";
export const AGENDA_ICON = "calendar-days";

const IMMINENT_WINDOW_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Below this content width the view switches to its narrow side-panel layout. */
const COMPACT_MAX_WIDTH = 460;

export interface AgendaViewEvents extends Record<string, unknown> {
	/** Fired whenever meeting/recording state changes and the view should reload. */
	changed: void;
}

/** Everything the agenda view needs from the plugin, kept decoupled for testing. */
export interface AgendaViewHost {
	getLookAhead(): number;
	getLookBack(): number;
	setLookAhead(n: number): void;
	isAuthenticated(): boolean;
	authenticate(): Promise<void>;
	/** Fetch meetings within [fromMs, toMs], enriched with note/recording state. */
	fetchMeetings(fromMs: number, toMs: number): Promise<AgendaMeeting[]>;
	isRecordingThis(meeting: AgendaMeeting): boolean;
	onOpenOrCreate(meeting: AgendaMeeting): void;
	onCreateAndRecord(meeting: AgendaMeeting): void;
	onCreateNote(meeting: AgendaMeeting): void;
	onStop(): void;
	onOpenRecording(meeting: AgendaMeeting): void;
	onTranscribe(meeting: AgendaMeeting, mode: "diarized" | "mixed"): void;
	onEnrich(meeting: AgendaMeeting): void;
	onOpenLink(url: string): void;
	onCopyLink(url: string): void;
	openSettings(): void;
	events: TypedEventBus<AgendaViewEvents>;
}

/**
 * The "Coming up" agenda. Renders one card per day in the look-ahead window,
 * with a highlighted "Now" card for a live/imminent meeting. The same view
 * serves both the main workspace tab and the narrow side panel — it measures its
 * own width and drops to a compact layout below {@link COMPACT_MAX_WIDTH}.
 */
export class MeetingAgendaView extends ItemView {
	private earlierCollapsed = true;
	private focusedDay = keyOf(new Date());
	private meetings: AgendaMeeting[] = [];
	private loading = false;
	private errorMsg: string | null = null;
	private lastFetchAt = 0;
	private skipped = new Set<string>();
	private unsub: (() => void) | null = null;
	private tickTimer: number | null = null;
	private resetScroll = false;
	private reloadSeq = 0;

	constructor(leaf: WorkspaceLeaf, private host: AgendaViewHost) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_AGENDA;
	}

	getDisplayText(): string {
		return t().agenda.title;
	}

	getIcon(): string {
		return AGENDA_ICON;
	}

	onOpen(): Promise<void> {
		this.unsub = this.host.events.on("changed", () => void this.reload());
		// Re-render every minute so "Now / starts in N min" stays fresh.
		this.tickTimer = window.setInterval(() => this.render(), 60_000);
		void this.reload();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.unsub?.();
		this.unsub = null;
		if (this.tickTimer !== null) {
			window.clearInterval(this.tickTimer);
			this.tickTimer = null;
		}
		this.contentEl.empty();
		return Promise.resolve();
	}

	/** Re-render on leaf resize so the compact/wide layout tracks the width. */
	onResize(): void {
		if (this.contentEl.childElementCount > 0) this.render();
	}

	/** Fetches the current window and re-renders. Safe against overlapping calls. */
	async reload(): Promise<void> {
		if (!this.host.isAuthenticated()) {
			this.meetings = [];
			this.render();
			return;
		}
		const seq = ++this.reloadSeq;
		this.loading = true;
		this.render();

		const lookAhead = Math.max(1, this.host.getLookAhead());
		const lookBack = Math.max(0, Math.min(30, this.host.getLookBack()));
		const today = startOfDay(new Date());
		const focused = dateOf(this.focusedDay);
		const from = Math.min(today.getTime() - lookBack * DAY_MS, focused.getTime());
		const to = Math.max(today.getTime(), focused.getTime()) + lookAhead * DAY_MS;

		try {
			const meetings = await this.host.fetchMeetings(from, to);
			if (seq !== this.reloadSeq) return; // superseded by a newer reload
			this.meetings = meetings;
			this.errorMsg = null;
			this.lastFetchAt = Date.now();
		} catch (e) {
			if (seq !== this.reloadSeq) return;
			this.errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			if (seq === this.reloadSeq) {
				this.loading = false;
				this.render();
			}
		}
	}

	private isCompact(): boolean {
		const w = this.contentEl.clientWidth;
		return w > 0 && w < COMPACT_MAX_WIDTH;
	}

	private subtext(): string {
		const a = t().agenda;
		if (!this.host.isAuthenticated()) return a.notConnected;
		if (this.loading) return a.loading;
		if (this.errorMsg) return this.errorMsg;
		if (this.lastFetchAt === 0) return a.loading;
		return a.lastRefreshed(moment(this.lastFetchAt).fromNow());
	}

	render(): void {
		this.contentEl.empty();
		const a = t().agenda;
		const compact = this.isCompact();

		const root = this.contentEl.createDiv({ cls: "mc-cal" });
		if (compact) root.addClass("is-compact");
		const shell = root.createDiv({ cls: "mc-cal-inner" });

		const lookAhead = Math.max(1, this.host.getLookAhead());
		const lookBack = Math.max(0, Math.min(30, this.host.getLookBack()));
		const now = Date.now();
		const today = startOfDay(new Date(now));
		const todayKey = keyOf(today);
		const minKey = keyOf(new Date(today.getTime() - lookBack * DAY_MS));
		if (this.focusedDay < minKey) this.focusedDay = minKey;

		const visible = this.visibleMeetings();
		const daysWithMeetings = new Set(visible.map((m) => keyOf(m.start)));

		renderStatusHeader({
			parent: shell,
			subtext: this.subtext(),
			lookAheadDays: lookAhead,
			focusedDay: this.focusedDay,
			today: todayKey,
			minDay: minKey,
			daysWithMeetings,
			compact,
			onRefresh: () => void this.reload(),
			onOpenSettings: () => this.host.openSettings(),
			onPickDay: (k) => this.jumpToDay(k),
			onChangeDays: (n) => this.changeDays(n),
		});

		if (!this.host.isAuthenticated()) {
			this.renderConnectState(shell);
			return;
		}

		if (this.errorMsg) {
			shell.createDiv({ cls: "mc-cal-error", text: this.errorMsg });
		}

		const byDay = new Map<string, AgendaMeeting[]>();
		for (const m of visible) {
			const k = keyOf(m.start);
			if (!byDay.has(k)) byDay.set(k, []);
			byDay.get(k)!.push(m);
		}

		// "Now" card — only when focused on today and a meeting is imminent/live.
		let currentId: string | null = null;
		if (this.focusedDay === todayKey) {
			const todays = byDay.get(todayKey) ?? [];
			const current = todays.find(
				(m) =>
					m.start.getTime() <= now + IMMINENT_WINDOW_MS &&
					m.end.getTime() > now
			);
			if (current) {
				currentId = current.id;
				renderCurrentMeeting({
					parent: shell,
					meeting: current,
					recordingThis: this.host.isRecordingThis(current),
					compact,
					onOpenNote: (m) => this.host.onOpenOrCreate(m),
					onCreateAndRecord: (m) => this.host.onCreateAndRecord(m),
					onStop: () => this.host.onStop(),
					onOpenLink: current.meetingUrl ? (m) => this.openLink(m) : null,
				});
			}
		}

		const focusedDate = dateOf(this.focusedDay);
		const list = shell.createDiv({ cls: "mc-cal-days" });
		let emptyRun = 0;
		let renderedAny = false;

		for (let i = 0; i < lookAhead; i++) {
			const date = new Date(focusedDate.getTime() + i * DAY_MS);
			const key = keyOf(date);
			const dayMeetings = byDay.get(key) ?? [];
			const isFocusedDay = i === 0;

			if (dayMeetings.length === 0 && !isFocusedDay) {
				emptyRun++;
				continue;
			}
			if (emptyRun > 0) {
				this.renderGap(list, emptyRun);
				emptyRun = 0;
			}
			renderedAny = true;
			this.renderDay(list, {
				date,
				key,
				meetings: dayMeetings,
				isToday: key === todayKey,
				isPast: key < todayKey,
				now,
				isFocusedDay,
				currentId,
				compact,
			});
		}

		if (emptyRun > 0) this.renderGap(list, emptyRun);
		if (!renderedAny && emptyRun === 0) {
			list.createDiv({ cls: "mc-cal-empty", text: a.nothingScheduled });
		}

		if (this.resetScroll) {
			this.resetScroll = false;
			// Return the list to the top so the header (and its Prev/Next controls)
			// stays in view after a day jump.
			window.requestAnimationFrame(() => {
				this.contentEl.scrollTop = 0;
			});
		}
	}

	private renderConnectState(parent: HTMLElement): void {
		const a = t().agenda;
		const box = parent.createDiv({ cls: "mc-cal-connect" });
		box.createEl("p", { cls: "mc-cal-connect-text", text: a.connectPrompt });
		const btn = box.createEl("button", {
			cls: "mc-cal-connect-cta",
			text: a.connectCta,
		});
		btn.addEventListener("click", () => {
			void (async () => {
				await this.host.authenticate();
				await this.reload();
			})();
		});
	}

	private renderDay(
		parent: HTMLElement,
		o: {
			date: Date;
			key: string;
			meetings: AgendaMeeting[];
			isToday: boolean;
			isPast: boolean;
			now: number;
			isFocusedDay: boolean;
			currentId: string | null;
			compact: boolean;
		}
	): void {
		const a = t().agenda;
		const day = parent.createDiv({ cls: "mc-cal-day" });
		if (o.isToday) day.addClass("is-today");
		if (o.isPast) day.addClass("is-past");

		const date = day.createDiv({ cls: "mc-cal-day-date" });
		date.createDiv({
			cls: "mc-cal-day-num",
			text: String(o.date.getDate()),
		});
		date.createDiv({
			cls: "mc-cal-day-mon",
			text: moment(o.date).format("MMM"),
		});
		date.createDiv({
			cls: "mc-cal-day-dow",
			text: moment(o.date).format("ddd"),
		});

		const card = day.createDiv({ cls: "mc-cal-day-card" });

		let toRender = o.meetings;
		let earlier: AgendaMeeting[] = [];
		if (o.isToday && o.isFocusedDay) {
			earlier = o.meetings.filter((m) => m.end.getTime() <= o.now);
			toRender = o.meetings.filter(
				(m) => m.end.getTime() > o.now && m.id !== o.currentId
			);
		}

		if (toRender.length === 0 && earlier.length === 0) {
			card.createDiv({
				cls: "mc-cal-day-empty",
				text: o.meetings.length === 0 ? a.noMeetings : a.nothingElse,
			});
		}

		for (const meeting of toRender) {
			renderMeetingRow({
				parent: card,
				meeting,
				now: o.now,
				handlers: this.rowHandlers(),
				compact: o.compact,
			});
		}

		if (earlier.length > 0) this.renderEarlier(card, earlier, o.now, o.compact);
	}

	private renderEarlier(
		parent: HTMLElement,
		meetings: AgendaMeeting[],
		now: number,
		compact: boolean
	): void {
		const a = t().agenda;
		const section = parent.createDiv({ cls: "mc-cal-earlier" });
		if (this.earlierCollapsed) section.addClass("is-collapsed");

		const header = section.createDiv({ cls: "mc-cal-earlier-head" });
		const chevron = header.createSpan({ cls: "mc-cal-earlier-chevron" });
		setIcon(chevron, "chevron-down");
		header.createSpan({ cls: "mc-cal-earlier-label", text: a.earlierToday });
		header.createSpan({
			cls: "mc-cal-earlier-count",
			text: String(meetings.length),
		});
		header.addEventListener("click", () => {
			this.earlierCollapsed = !this.earlierCollapsed;
			this.render();
		});

		const body = section.createDiv({ cls: "mc-cal-earlier-body" });
		for (const meeting of meetings) {
			renderMeetingRow({
				parent: body,
				meeting,
				now,
				handlers: this.rowHandlers(),
				compact,
			});
		}
	}

	private renderGap(parent: HTMLElement, count: number): void {
		parent.createDiv({
			cls: "mc-cal-gap",
			text: t().agenda.daysWithoutEvents(count),
		});
	}

	private rowHandlers(): RowHandlers {
		return {
			onOpenOrCreate: (m) => this.host.onOpenOrCreate(m),
			onCreateAndRecord: (m) => this.host.onCreateAndRecord(m),
			onCreateNote: (m) => this.host.onCreateNote(m),
			onStop: () => this.host.onStop(),
			onOpenRecording: (m) => this.host.onOpenRecording(m),
			onTranscribe: (m, mode) => this.host.onTranscribe(m, mode),
			onEnrich: (m) => this.host.onEnrich(m),
			onOpenLink: (m) => this.openLink(m),
			onCopyLink: (m) => {
				if (m.meetingUrl) this.host.onCopyLink(m.meetingUrl);
			},
			onSkip: (m) => {
				this.skipped.add(m.id);
				this.render();
			},
			isRecordingThis: (m) => this.host.isRecordingThis(m),
		};
	}

	private openLink(m: AgendaMeeting): void {
		if (m.meetingUrl) this.host.onOpenLink(m.meetingUrl);
	}

	private jumpToDay(k: string): void {
		this.focusedDay = k;
		this.resetScroll = true;
		void this.reload();
	}

	private changeDays(n: number): void {
		this.host.setLookAhead(n);
		void this.reload();
	}

	private visibleMeetings(): AgendaMeeting[] {
		return this.meetings.filter((m) => !this.skipped.has(m.id));
	}
}

function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}

function keyOf(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${dd}`;
}

function dateOf(k: string): Date {
	const [y, m, d] = k.split("-").map((x) => parseInt(x, 10));
	return new Date(y!, (m ?? 1) - 1, d ?? 1);
}
