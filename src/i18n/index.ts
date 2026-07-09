import { en, type Messages } from "./en";
import { ja } from "./ja";

const LOCALES: Record<string, Messages> = { en, ja };

/** Obsidian stores the active display language in localStorage under "language". */
function currentLocale(): string {
	try {
		return window.localStorage.getItem("language") || "en";
	} catch {
		return "en";
	}
}

/** Returns the message bundle for the active Obsidian language, falling back to English. */
export function t(): Messages {
	return LOCALES[currentLocale()] ?? en;
}

export type { Messages };
