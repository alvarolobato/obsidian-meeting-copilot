import { App, Modal, Setting } from "obsidian";

export interface MeetingPromptModalOptions {
	/** Meeting name, shown as the heading. */
	title: string;
	/** Timing line, e.g. "Starts in 1 min" or "Started 3 min ago". */
	subtitle: string;
	/** When false, the Join / Join & record buttons are hidden (no meeting link). */
	hasLink: boolean;
	joinLabel: string;
	recordLabel: string;
	joinAndRecordLabel: string;
	dismissLabel: string;
	/** Open the meeting link only. */
	onJoin: () => void;
	/** Create the note and start recording only. */
	onRecord: () => void;
	/** Open the link and start recording. */
	onJoinAndRecord: () => void;
}

/**
 * The rich meeting prompt opened when the user clicks the system notification
 * for an upcoming/starting meeting. Offers Join, Record, and (when a link
 * exists) Join & record, plus a plain dismiss. Each action closes the modal.
 *
 * The two-step notification → modal flow is deliberate: renderer Web
 * Notifications can't render action buttons, so the notification carries the
 * timing and a click brings the user here where the real choices live.
 */
export class MeetingPromptModal extends Modal {
	constructor(
		app: App,
		private readonly opts: MeetingPromptModalOptions
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("mc-meeting-prompt");
		contentEl.createEl("h3", { text: this.opts.title });
		contentEl.createEl("p", {
			text: this.opts.subtitle,
			cls: "mc-meeting-prompt-subtitle",
		});

		const setting = new Setting(contentEl);
		if (this.opts.hasLink) {
			setting.addButton((b) =>
				b
					.setButtonText(this.opts.joinAndRecordLabel)
					.setCta()
					.onClick(() => this.run(this.opts.onJoinAndRecord))
			);
			setting.addButton((b) =>
				b
					.setButtonText(this.opts.joinLabel)
					.onClick(() => this.run(this.opts.onJoin))
			);
			setting.addButton((b) =>
				b
					.setButtonText(this.opts.recordLabel)
					.onClick(() => this.run(this.opts.onRecord))
			);
		} else {
			setting.addButton((b) =>
				b
					.setButtonText(this.opts.recordLabel)
					.setCta()
					.onClick(() => this.run(this.opts.onRecord))
			);
		}
		setting.addButton((b) =>
			b.setButtonText(this.opts.dismissLabel).onClick(() => this.close())
		);
	}

	private run(action: () => void): void {
		this.close();
		action();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
