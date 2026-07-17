/**
 * Resolves a "shippable default vs. user override" text setting. Returns the
 * live `fallback` (the plugin's built-in default, read fresh so it follows
 * plugin updates) unless the user opted into customizing AND stored non-empty
 * custom text; a blank custom value falls back to the default too.
 *
 * This is the seam that lets us stop persisting a full copy of each default:
 * a non-customizing vault stores nothing, so improving the default in code
 * reaches everyone with no migration. Pure/testable.
 */
export function resolveCustomizable(
	customize: boolean,
	custom: string | null | undefined,
	fallback: string
): string {
	// Defensive: a hand-edited/corrupt data.json could store a non-string here,
	// so coerce anything that isn't a usable string to the fallback rather than
	// throwing on `.trim()` mid-enrichment.
	const text = typeof custom === "string" ? custom : "";
	return customize && text.trim().length > 0 ? text : fallback;
}
