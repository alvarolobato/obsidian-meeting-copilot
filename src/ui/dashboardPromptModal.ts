import { App, Modal, Setting } from "obsidian";

export interface DashboardPromptModalOptions {
	heading: string;
	desc: string;
	createLabel: string;
	laterLabel: string;
	dontAskAgainLabel: string;
	onCreate: () => void;
	onDontAskAgain: () => void;
}

/**
 * Shown once on a clean install (no dashboard note yet) to offer creating the
 * meetings dashboard. "Later" just closes the modal — it's offered again next
 * launch. "Don't ask again" persists a settings flag so it never reappears.
 */
export class DashboardPromptModal extends Modal {
	constructor(
		app: App,
		private readonly opts: DashboardPromptModalOptions
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.opts.heading });
		contentEl.createEl("p", { text: this.opts.desc });

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText(this.opts.createLabel)
					.setCta()
					.onClick(() => {
						this.close();
						this.opts.onCreate();
					})
			)
			.addButton((b) =>
				b.setButtonText(this.opts.laterLabel).onClick(() => this.close())
			)
			.addButton((b) =>
				b.setButtonText(this.opts.dontAskAgainLabel).onClick(() => {
					this.close();
					this.opts.onDontAskAgain();
				})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
