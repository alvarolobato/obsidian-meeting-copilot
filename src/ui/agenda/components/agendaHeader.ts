import { moment, setIcon } from "obsidian";
import { t } from "../../../i18n";
import { DayPicker } from "./dayPicker";

const MS_PER_DAY = 86_400_000;
const MAX_LOOKAHEAD = 180;

export interface AgendaHeaderOptions {
	parent: HTMLElement;
	/** Status line under the title (auth / loading / error / last-refresh). */
	subtext: string;
	lookAheadDays: number;
	/** Focused day, `YYYY-MM-DD`. */
	focusedDay: string;
	/** Today, `YYYY-MM-DD`. */
	today: string;
	/** Earliest navigable day (today minus look-back), `YYYY-MM-DD`. */
	minDay: string;
	/** Days that have at least one meeting (drives picker dots). */
	daysWithMeetings: Set<string>;
	/** Narrow side-panel layout: smaller type, stacked nav, fewer controls. */
	compact: boolean;
	onRefresh: () => void;
	onOpenSettings: () => void;
	onPickDay: (key: string) => void;
	onChangeDays: (n: number) => void;
}

/** Renders the "Coming up" title, action buttons and the day-navigation bar. */
export function renderAgendaHeader(opts: AgendaHeaderOptions): void {
	const a = t().agenda;
	const head = opts.parent.createDiv({ cls: "mc-cal-head" });
	if (opts.compact) head.addClass("is-compact");

	const top = head.createDiv({ cls: "mc-cal-head-top" });
	top.createDiv({ cls: "mc-cal-head-title", text: a.comingUp });

	const controls = top.createDiv({ cls: "mc-cal-head-controls" });
	addIconButton(controls, "rotate-cw", a.refresh, opts.onRefresh);
	addIconButton(controls, "settings-2", a.openSettings, opts.onOpenSettings);

	// In the wide layout the day navigation sits inline with the actions; in the
	// narrow side panel it drops to its own compact row beneath the title.
	if (!opts.compact) {
		controls.createDiv({ cls: "mc-cal-head-divider" });
		renderNav(controls, opts, { withDays: true });
	} else {
		const nav = head.createDiv({ cls: "mc-cal-nav-row" });
		renderNav(nav, opts, { withDays: false });
	}

	head.createDiv({ cls: "mc-cal-head-sub", text: opts.subtext });
}

function renderNav(
	parent: HTMLElement,
	opts: AgendaHeaderOptions,
	cfg: { withDays: boolean }
): void {
	const a = t().agenda;
	const focused = fromKey(opts.focusedDay);
	const nav = parent.createDiv({ cls: "mc-cal-nav" });

	// One-click jump back to today — the date pill below opens the full
	// day-picker grid regardless of which day is focused, which is a lot of
	// friction just to snap back after navigating away.
	const isToday = opts.focusedDay === opts.today;
	const todayBtn = nav.createEl("button", {
		cls: "mc-cal-nav-today",
		text: a.todayLabel,
		attr: { "aria-label": a.todayLabel },
	});
	if (isToday) {
		todayBtn.setAttribute("disabled", "true");
	} else {
		todayBtn.addEventListener("click", () => opts.onPickDay(opts.today));
	}

	const prev = addIconButton(nav, "chevron-left", a.previousDay, () => {
		if (opts.focusedDay <= opts.minDay) return;
		opts.onPickDay(toKey(new Date(focused.getTime() - MS_PER_DAY)));
	});
	if (opts.focusedDay <= opts.minDay) prev.setAttribute("disabled", "true");

	const pill = nav.createEl("button", {
		cls: "mc-cal-nav-date",
		text: dateLabel(focused, opts.today),
	});
	let picker: DayPicker | null = null;
	pill.addEventListener("click", () => {
		if (picker?.isOpen()) {
			picker.close();
			picker = null;
			return;
		}
		picker = new DayPicker({
			anchor: pill,
			focusedDay: opts.focusedDay,
			today: opts.today,
			minDay: opts.minDay,
			daysWithMeetings: opts.daysWithMeetings,
			onPick: (k) => opts.onPickDay(k),
		});
		picker.open();
	});

	addIconButton(nav, "chevron-right", a.nextDay, () => {
		opts.onPickDay(toKey(new Date(focused.getTime() + MS_PER_DAY)));
	});

	if (cfg.withDays) renderDaysPill(nav, opts);
}

function renderDaysPill(nav: HTMLElement, opts: AgendaHeaderOptions): void {
	const a = t().agenda;
	const pill = nav.createEl("button", {
		cls: "mc-cal-nav-days",
		text: `${opts.lookAheadDays}d`,
		attr: { "aria-label": a.daysShown },
	});
	pill.addEventListener("click", () => {
		const input = nav.createEl("input", {
			cls: "mc-cal-nav-days-input",
			attr: {
				type: "number",
				min: "1",
				max: String(MAX_LOOKAHEAD),
				value: String(opts.lookAheadDays),
				"aria-label": a.daysShown,
			},
		});
		pill.replaceWith(input);
		input.focus();
		input.select();

		let done = false;
		const commit = () => {
			if (done) return;
			done = true;
			const n = parseInt(input.value, 10);
			if (Number.isFinite(n) && n >= 1 && n <= MAX_LOOKAHEAD) {
				if (n !== opts.lookAheadDays) opts.onChangeDays(n);
				else input.replaceWith(pill);
			} else {
				input.replaceWith(pill);
			}
		};
		const abort = () => {
			if (done) return;
			done = true;
			input.replaceWith(pill);
		};
		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				commit();
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				abort();
			}
		});
	});
}

function addIconButton(
	parent: HTMLElement,
	icon: string,
	label: string,
	onClick: () => void
): HTMLButtonElement {
	const btn = parent.createEl("button", {
		cls: "mc-cal-icon-btn",
		attr: { "aria-label": label },
	});
	setIcon(btn, icon);
	btn.addEventListener("click", () => onClick());
	return btn;
}

function dateLabel(date: Date, today: string): string {
	if (toKey(date) === today) return moment(date).format("[Today] · ddd, MMM D");
	return moment(date).format("ddd, MMM D");
}

function fromKey(key: string): Date {
	const [y, m, d] = key.split("-").map((n) => parseInt(n, 10));
	return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function toKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}
