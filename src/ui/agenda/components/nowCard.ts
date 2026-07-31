import { moment, setIcon } from "obsidian";
import { t } from "../../../i18n";
import type { AgendaMeeting } from "../agendaModel";

export interface NowCardOptions {
	parent: HTMLElement;
	meeting: AgendaMeeting;
	recordingThis: boolean;
	/** True when a stop has been requested but the helper has not exited yet. */
	stoppingThis: boolean;
	/** Open the existing note (used whenever `meeting.note` is set). */
	onOpenNote: (m: AgendaMeeting) => void;
	/**
	 * Create the note (if needed) and start recording. Backs the primary CTA
	 * when no note exists yet, so its label matches what it does.
	 */
	onCreateAndRecord: (m: AgendaMeeting) => void;
	onStop: () => void;
	onOpenLink: ((m: AgendaMeeting) => void) | null;
	/** Narrow side-panel layout. */
	compact?: boolean;
}

/** The highlighted card shown when a meeting is live or about to start. */
export function renderNowCard(opts: NowCardOptions): void {
	const { meeting } = opts;
	const a = t().agenda;
	const now = Date.now();

	const card = opts.parent.createDiv({
		cls: "mc-cal-now mc-cal-accent-live",
	});
	if (opts.compact) card.addClass("is-compact");

	const info = card.createDiv({ cls: "mc-cal-now-info" });
	info.createDiv({ cls: "mc-cal-now-dot" });

	const text = info.createDiv({ cls: "mc-cal-now-text" });
	const status = opts.recordingThis
		? a.recording
		: meeting.start.getTime() <= now
			? a.now
			: a.startsIn(
					Math.max(1, Math.round((meeting.start.getTime() - now) / 60000))
				);
	text.createDiv({ cls: "mc-cal-now-status", text: status });
	text.createDiv({ cls: "mc-cal-now-title", text: meeting.title });
	text.createDiv({
		cls: "mc-cal-now-time",
		text: `${moment(meeting.start).format("HH:mm")}–${moment(meeting.end).format("HH:mm")}`,
	});

	const actions = card.createDiv({ cls: "mc-cal-now-actions" });

	if (opts.recordingThis) {
		// While recording, still let the user jump to the note (it exists once
		// recording started) — not just stop.
		if (meeting.note) {
			const openNote = actions.createEl("button", {
				cls: "mc-cal-now-cta",
				text: a.actions.openNote,
			});
			openNote.addEventListener("click", (evt) => {
				evt.stopPropagation();
				opts.onOpenNote(meeting);
			});
		}
		const stop = actions.createEl("button", {
			cls: "mc-cal-now-cta is-danger",
			text: opts.stoppingThis ? a.actions.stopping : a.actions.stop,
		});
		stop.disabled = opts.stoppingThis;
		stop.addEventListener("click", (evt) => {
			evt.stopPropagation();
			opts.onStop();
		});
	} else {
		const primary = actions.createEl("button", {
			cls: "mc-cal-now-cta",
			text: meeting.note ? a.actions.openNote : t().event.createNoteAndRecord,
		});
		// Keep the action in lockstep with the label: open the existing note, or
		// (no note yet) create it and start recording.
		primary.addEventListener("click", (evt) => {
			evt.stopPropagation();
			if (meeting.note) {
				opts.onOpenNote(meeting);
			} else {
				opts.onCreateAndRecord(meeting);
			}
		});
	}

	if (opts.onOpenLink && meeting.meetingUrl) {
		const link = actions.createEl("button", {
			cls: "mc-cal-now-link",
			attr: { "aria-label": a.actions.openLink },
		});
		setIcon(link, "video");
		link.addEventListener("click", (evt) => {
			evt.stopPropagation();
			opts.onOpenLink!(meeting);
		});
	}

	// Clicking anywhere else on the card opens the note (or creates it,
	// never starting a recording as a side effect) — same primary-click
	// semantics as a regular day-card event row (see eventRow.ts).
	card.addEventListener("click", () => opts.onOpenNote(meeting));
}
