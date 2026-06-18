import { Notice } from "obsidian";

/**
 * Shows a persistent Notice (no auto-timeout) with a single action button.
 * Clicking the button runs `onClick` and dismisses the notice.
 */
export function actionNotice(message: string, buttonLabel: string, onClick: () => void): Notice {
	const frag = document.createDocumentFragment();
	const container = frag.createDiv();
	container.createSpan({ text: message });
	const btn = container.createEl("button", { text: buttonLabel, cls: "mod-cta" });
	btn.setCssProps({ "margin-inline-start": "8px" });
	const notice = new Notice(frag, 0);
	btn.addEventListener("click", () => {
		onClick();
		notice.hide();
	});
	return notice;
}
