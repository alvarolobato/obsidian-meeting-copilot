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
	const trimmed = (custom ?? "").trim();
	return customize && trimmed.length > 0 ? (custom as string) : fallback;
}
