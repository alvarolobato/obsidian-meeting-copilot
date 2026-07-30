import { moment, setIcon } from "obsidian";
import { t } from "../../../i18n";

const MS_PER_DAY = 86_400_000;
const WEEKDAY_INITIALS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const CELLS = 42; // 6 weeks

export interface DayPickerOptions {
	/** Button the popup hangs beneath (the date label in the nav bar). */
	anchor: HTMLElement;
	/** Currently focused agenda day, `YYYY-MM-DD`. */
	focusedDay: string;
	/** Real today, `YYYY-MM-DD`. */
	today: string;
	/** Earliest selectable day (today minus the look-back window), `YYYY-MM-DD`. */
	minDay: string;
	/** Days (`YYYY-MM-DD`) that hold at least one meeting — marked with a dot. */
	daysWithMeetings: Set<string>;
	onPick: (key: string) => void;
}

/** A small month-grid popover for jumping the agenda to any day. */
export class DayPicker {
	private popover: HTMLElement | null = null;
	private cursor: Date;
	private onDocPointer: ((e: MouseEvent) => void) | null = null;
	private onDocKey: ((e: KeyboardEvent) => void) | null = null;

	constructor(private readonly opts: DayPickerOptions) {
		const focused = fromKey(opts.focusedDay);
		this.cursor = new Date(focused.getFullYear(), focused.getMonth(), 1);
	}

	isOpen(): boolean {
		return this.popover !== null;
	}

	private get doc(): Document {
		return this.opts.anchor.ownerDocument;
	}

	open(): void {
		if (this.popover) return;
		this.popover = this.doc.body.createDiv({ cls: "mc-cal-picker" });
		this.place();
		this.draw();

		this.onDocPointer = (e) => {
			const target = e.target as Node | null;
			if (!this.popover || !target) return;
			if (this.popover.contains(target) || this.opts.anchor.contains(target)) {
				return;
			}
			this.close();
		};
		this.onDocKey = (e) => {
			if (e.key === "Escape") this.close();
		};
		// Defer binding so the click that opened us doesn't instantly close us.
		window.setTimeout(() => {
			if (this.onDocPointer) {
				this.doc.addEventListener("mousedown", this.onDocPointer);
			}
			if (this.onDocKey) this.doc.addEventListener("keydown", this.onDocKey);
		}, 0);
	}

	close(): void {
		if (this.onDocPointer) {
			this.doc.removeEventListener("mousedown", this.onDocPointer);
			this.onDocPointer = null;
		}
		if (this.onDocKey) {
			this.doc.removeEventListener("keydown", this.onDocKey);
			this.onDocKey = null;
		}
		this.popover?.remove();
		this.popover = null;
	}

	private place(): void {
		if (!this.popover) return;
		const rect = this.opts.anchor.getBoundingClientRect();
		const width = 248;
		let left = rect.left;
		if (left + width > window.innerWidth - 8) {
			left = Math.max(8, window.innerWidth - width - 8);
		}
		this.popover.style.setProperty("--mc-cal-picker-left", `${left}px`);
		this.popover.style.setProperty("--mc-cal-picker-top", `${rect.bottom + 6}px`);
	}

	private shiftMonth(delta: number): void {
		this.cursor = new Date(
			this.cursor.getFullYear(),
			this.cursor.getMonth() + delta,
			1
		);
		this.draw();
	}

	private draw(): void {
		if (!this.popover) return;
		this.popover.empty();
		const a = t().agenda;

		const bar = this.popover.createDiv({ cls: "mc-cal-picker-bar" });
		const prev = bar.createEl("button", {
			cls: "mc-cal-picker-step",
			attr: { "aria-label": a.previousMonth },
		});
		setIcon(prev, "chevron-left");
		prev.addEventListener("click", () => this.shiftMonth(-1));

		bar.createSpan({
			cls: "mc-cal-picker-title",
			text: moment(this.cursor).format("MMMM YYYY"),
		});

		const next = bar.createEl("button", {
			cls: "mc-cal-picker-step",
			attr: { "aria-label": a.nextMonth },
		});
		setIcon(next, "chevron-right");
		next.addEventListener("click", () => this.shiftMonth(1));

		const heads = this.popover.createDiv({ cls: "mc-cal-picker-weekdays" });
		for (const initial of WEEKDAY_INITIALS) {
			heads.createSpan({ cls: "mc-cal-picker-weekday", text: initial });
		}

		const grid = this.popover.createDiv({ cls: "mc-cal-picker-grid" });
		const firstWeekday = (this.cursor.getDay() + 6) % 7; // Monday-based
		const gridStart = new Date(this.cursor);
		gridStart.setDate(this.cursor.getDate() - firstWeekday);

		for (let i = 0; i < CELLS; i++) {
			const date = new Date(gridStart.getTime() + i * MS_PER_DAY);
			const key = toKey(date);
			const cell = grid.createEl("button", {
				cls: "mc-cal-picker-day",
				text: String(date.getDate()),
			});
			if (date.getMonth() !== this.cursor.getMonth()) {
				cell.addClass("is-outside");
			}
			if (key === this.opts.today) cell.addClass("is-today");
			if (key === this.opts.focusedDay) cell.addClass("is-selected");
			if (this.opts.daysWithMeetings.has(key)) cell.addClass("has-events");
			if (key < this.opts.minDay) {
				cell.setAttribute("disabled", "true");
				continue;
			}
			if (key < this.opts.today) cell.addClass("is-past");
			cell.addEventListener("click", () => {
				this.opts.onPick(key);
				this.close();
			});
		}
	}
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
