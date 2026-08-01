import { Menu, moment, setIcon } from "obsidian";
import { t } from "../../../i18n";
import type { AgendaMeeting } from "../agendaModel";
import { accentClass, accentFor } from "./accent";

export interface RowHandlers {
	/** Primary click: open the meeting note, or create it if none exists yet. */
	onOpenOrCreate: (m: AgendaMeeting) => void;
	onCreateAndRecord: (m: AgendaMeeting) => void;
	onCreateNote: (m: AgendaMeeting) => void;
	onStop: () => void;
	onOpenRecording: (m: AgendaMeeting) => void;
	/**
	 * Re-transcribe the recording. `mode` chooses speaker separation
	 * ("diarized") or the single joint track ("mixed"), independent of the
	 * configured default.
	 */
	onTranscribe: (m: AgendaMeeting, mode: "diarized" | "mixed") => void;
	onImportTranscript: (m: AgendaMeeting) => void;
	onEnrich: (m: AgendaMeeting) => void;
	onOpenLink: ((m: AgendaMeeting) => void) | null;
	onCopyLink: ((m: AgendaMeeting) => void) | null;
	onSkip: (m: AgendaMeeting) => void;
	/** True while this meeting is the one actively recording. */
	isRecordingThis: (m: AgendaMeeting) => boolean;
	/** True when a stop has been requested but the helper has not exited yet. */
	isStoppingThis: (m: AgendaMeeting) => boolean;
}

export interface EventRowOptions {
	parent: HTMLElement;
	meeting: AgendaMeeting;
	now: number;
	handlers: RowHandlers;
	/**
	 * Narrow side-panel layout: hides the attendee/location meta line and keeps
	 * only the open-link trailing button (the rest stay in the context menu).
	 */
	compact?: boolean;
}

/** Renders one event row inside a day card. */
export function renderEventRow(opts: EventRowOptions): void {
	const { meeting, handlers, now, compact = false } = opts;
	const a = t().agenda;

	const isLive =
		meeting.start.getTime() <= now && meeting.end.getTime() > now;
	const isUpcoming = meeting.start.getTime() > now;

	const row = opts.parent.createDiv({ cls: "mc-cal-event" });
	row.addClass(accentClass(isLive ? "live" : accentFor(meeting)));
	if (meeting.note) row.addClass("has-note");

	row.createDiv({ cls: "mc-cal-event-bar" });

	const body = row.createDiv({ cls: "mc-cal-event-body" });
	body.createDiv({ cls: "mc-cal-event-title", text: meeting.title });

	if (!compact) {
		const meta: string[] = [];
		meta.push(
			`${moment(meeting.start).format("HH:mm")}–${moment(meeting.end).format("HH:mm")}`
		);
		if (meeting.location) meta.push(meeting.location);
		if (meeting.attendees.length > 0) {
			meta.push(a.attendeesCount(meeting.attendees.length));
		}
		body.createDiv({ cls: "mc-cal-event-meta", text: meta.join(" · ") });
	} else {
		body.createDiv({
			cls: "mc-cal-event-meta",
			text: `${moment(meeting.start).format("HH:mm")}–${moment(meeting.end).format("HH:mm")}`,
		});
	}

	const actions = row.createDiv({ cls: "mc-cal-event-actions" });

	if (compact) {
		// Only the join link fits at narrow widths; everything else is on the menu.
		if (meeting.meetingUrl && handlers.onOpenLink) {
			rowAction(actions, "video", a.actions.openLink, () =>
				handlers.onOpenLink!(meeting)
			);
		}
	} else {
		if (handlers.isRecordingThis(meeting)) {
			const stoppingThis = handlers.isStoppingThis(meeting);
			const stopBtn = rowAction(
				actions,
				"square",
				stoppingThis ? a.actions.stopping : a.actions.stop,
				() => handlers.onStop(),
				"is-danger"
			);
			stopBtn.disabled = stoppingThis;
		} else if (isLive || isUpcoming || meeting.recording) {
			// Record stays available even after a recording exists — a new take
			// extends the same meeting — so relabel it when additive.
			const label = meeting.recording
				? a.actions.recordAgain
				: a.actions.record;
			rowAction(actions, "mic", label, () =>
				handlers.onCreateAndRecord(meeting)
			);
		}

		if (meeting.recording) {
			rowAction(actions, "file-check", a.actions.openRecording, () =>
				handlers.onOpenRecording(meeting)
			);
		}

		if (
			meeting.note &&
			(meeting.status === "transcribed" || meeting.recording)
		) {
			rowAction(actions, "sparkles", a.actions.enrich, () =>
				handlers.onEnrich(meeting)
			);
		}

		if (meeting.meetingUrl && handlers.onOpenLink) {
			rowAction(actions, "video", a.actions.openLink, () =>
				handlers.onOpenLink!(meeting)
			);
		}
	}

	row.addEventListener("click", () => handlers.onOpenOrCreate(meeting));
	row.addEventListener("contextmenu", (evt) => {
		evt.preventDefault();
		buildRowContextMenu(meeting, handlers).showAtMouseEvent(evt);
	});
}

function rowAction(
	parent: HTMLElement,
	icon: string,
	label: string,
	onClick: () => void,
	extra?: string
): HTMLButtonElement {
	const btn = parent.createEl("button", {
		cls: extra ? `mc-cal-event-btn ${extra}` : "mc-cal-event-btn",
		attr: { "aria-label": label },
	});
	setIcon(btn, icon);
	btn.addEventListener("click", (evt) => {
		evt.stopPropagation();
		onClick();
	});
	return btn;
}

export interface MeetingMenuOptions {
	/**
	 * Include agenda-list-only navigation items (open/create note, skip today).
	 * Off when shown from inside a note, where those don't apply.
	 */
	includeNavigation?: boolean;
}

/**
 * Adds the contextual meeting actions to an existing menu. Shared by the agenda
 * row's right-click menu and the note editor/file context menus, so both stay
 * in sync.
 */
export function populateMeetingMenu(
	menu: Menu,
	meeting: AgendaMeeting,
	handlers: RowHandlers,
	opts: MeetingMenuOptions = {}
): void {
	const a = t().agenda;

	if (opts.includeNavigation) {
		if (meeting.note) {
			menu.addItem((item) =>
				item
					.setTitle(a.actions.openNote)
					.setIcon("file-text")
					.onClick(() => handlers.onOpenOrCreate(meeting))
			);
		} else {
			menu.addItem((item) =>
				item
					.setTitle(a.actions.createNote)
					.setIcon("file-plus-2")
					.onClick(() => handlers.onCreateNote(meeting))
			);
		}
	}

	// Record is offered even when a recording already exists: a new take is
	// appended to the same meeting (and a silent first take auto-discards), so
	// the user is never stuck having to delete a recording to record again.
	if (!handlers.isRecordingThis(meeting)) {
		menu.addItem((item) =>
			item
				.setTitle(
					meeting.recording
						? t().event.recordAgain
						: t().event.createNoteAndRecord
				)
				.setIcon("mic")
				.onClick(() => handlers.onCreateAndRecord(meeting))
		);
	}

	if (handlers.isRecordingThis(meeting)) {
		menu.addItem((item) =>
			item
				.setTitle(
					handlers.isStoppingThis(meeting)
						? a.actions.stopping
						: a.actions.stop
				)
				.setIcon("square")
				.setDisabled(handlers.isStoppingThis(meeting))
				.onClick(() => handlers.onStop())
		);
	}

	if (meeting.recording) {
		menu.addItem((item) =>
			item
				.setTitle(a.actions.openRecording)
				.setIcon("file-check")
				.onClick(() => handlers.onOpenRecording(meeting))
		);
		// Offer both re-transcribe paths regardless of the default setting: with
		// speaker separation (me/them) and from the single joint track. The
		// diarized option falls back to the joint track when no separate tracks
		// were recorded.
		menu.addItem((item) =>
			item
				.setTitle(a.actions.transcribeDiarized)
				.setIcon("captions")
				.onClick(() => handlers.onTranscribe(meeting, "diarized"))
		);
		menu.addItem((item) =>
			item
				.setTitle(a.actions.transcribeMixed)
				.setIcon("captions")
				.onClick(() => handlers.onTranscribe(meeting, "mixed"))
		);
	}

	if (meeting.note) {
		// No `meeting.recording` gate: the whole point is offering this even when
		// there's no local recording, or to replace one with a more accurate
		// transcript obtained elsewhere (e.g. the official Zoom transcript).
		menu.addItem((item) =>
			item
				.setTitle(a.actions.importTranscript)
				.setIcon("file-up")
				.onClick(() => handlers.onImportTranscript(meeting))
		);
		menu.addItem((item) =>
			item
				.setTitle(a.actions.enrich)
				.setIcon("sparkles")
				.onClick(() => handlers.onEnrich(meeting))
		);
	}

	if (meeting.meetingUrl && handlers.onOpenLink) {
		menu.addItem((item) =>
			item
				.setTitle(a.actions.openLink)
				.setIcon("video")
				.onClick(() => handlers.onOpenLink!(meeting))
		);
	}
	if (meeting.meetingUrl && handlers.onCopyLink) {
		menu.addItem((item) =>
			item
				.setTitle(a.actions.copyLink)
				.setIcon("copy")
				.onClick(() => handlers.onCopyLink!(meeting))
		);
	}

	if (opts.includeNavigation) {
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(a.actions.skipToday)
				.setIcon("eye-off")
				.onClick(() => handlers.onSkip(meeting))
		);
	}
}

export function buildRowContextMenu(
	meeting: AgendaMeeting,
	handlers: RowHandlers
): Menu {
	const menu = new Menu();
	populateMeetingMenu(menu, meeting, handlers, { includeNavigation: true });
	return menu;
}
