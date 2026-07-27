/**
 * Filterable model-id combobox for settings, built on Obsidian's
 * {@link AbstractInputSuggest} (type-ahead popover attached to a text input).
 */
import { AbstractInputSuggest, App } from "obsidian";

/** One option in a model combobox (`value` is stored; `label` is shown). */
export interface ModelOption {
	value: string;
	label: string;
}

/**
 * Case-insensitive substring filter over label and value. Empty query returns
 * all options (caller may slice for display limits).
 */
export function filterModelOptions(
	options: readonly ModelOption[],
	query: string
): ModelOption[] {
	const q = query.toLowerCase().trim();
	if (!q) return [...options];
	return options.filter(
		(o) =>
			o.label.toLowerCase().includes(q) ||
			o.value.toLowerCase().includes(q)
	);
}

/**
 * Type-ahead suggestions for a model id input. Pass a live `getOptions` so a
 * later "Load models" refresh can rebuild the picker with new lists.
 */
export class ModelIdSuggest extends AbstractInputSuggest<ModelOption> {
	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		private readonly getOptions: () => ModelOption[],
		private readonly onPick: (value: string) => void
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): ModelOption[] {
		return filterModelOptions(this.getOptions(), query);
	}

	renderSuggestion(opt: ModelOption, el: HTMLElement): void {
		el.setText(opt.label);
	}

	selectSuggestion(opt: ModelOption, _evt: MouseEvent | KeyboardEvent): void {
		this.inputEl.value = opt.value;
		this.onPick(opt.value);
		this.close();
	}
}
