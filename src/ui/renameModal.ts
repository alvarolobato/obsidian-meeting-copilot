import { App, Modal, Setting, TextComponent } from "obsidian";

export interface RenameModalOptions {
	heading: string;
	desc: string;
	value: string;
	renameLabel: string;
	keepLabel: string;
	/** Called with the trimmed value when the user confirms the rename. */
	onRename: (value: string) => void;
}

/**
 * A small modal that offers an editable, pre-filled name and a Rename / Keep
 * choice. Used to let the user accept or tweak an AI-suggested meeting title.
 */
export class RenameModal extends Modal {
	private input!: TextComponent;

	constructor(
		app: App,
		private readonly opts: RenameModalOptions
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.opts.heading });
		contentEl.createEl("p", {
			text: this.opts.desc,
			cls: "mc-rename-desc",
		});

		this.input = new TextComponent(contentEl);
		this.input.setValue(this.opts.value);
		this.input.inputEl.addClass("mc-rename-input");
		this.input.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			}
		});

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText(this.opts.renameLabel)
					.setCta()
					.onClick(() => this.submit())
			)
			.addButton((b) =>
				b.setButtonText(this.opts.keepLabel).onClick(() => this.close())
			);

		// Focus + select so the user can type over the suggestion immediately.
		window.setTimeout(() => {
			this.input.inputEl.focus();
			this.input.inputEl.select();
		}, 0);
	}

	private submit(): void {
		const value = this.input.getValue().trim();
		this.close();
		if (value) this.opts.onRename(value);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
