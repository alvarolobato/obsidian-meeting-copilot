import { addIcon } from "obsidian";

/** Custom ribbon icon id for the on-demand ("unplanned meeting") record button. */
export const RECORD_ICON = "meeting-copilot-record";

// A calendar with a small microphone badge in the bottom-right corner —
// modeled on Lucide's `calendar-clock` (same cut-out calendar body) but with a
// mic in place of the clock. Authored in Lucide's 24px coordinate space and
// scaled to Obsidian's 100x100 icon viewBox.
const RECORD_ICON_SVG = `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/>
<path d="M8 2v4"/>
<path d="M16 2v4"/>
<path d="M3 10h7"/>
<rect x="16" y="12" width="3" height="5" rx="1.5"/>
<path d="M14.5 16v.5a3 3 0 0 0 6 0V16"/>
<path d="M17.5 19.5V21"/>
</g>`;

/** Registers Meeting Copilot's custom icons. Call once during plugin load. */
export function registerIcons(): void {
	addIcon(RECORD_ICON, RECORD_ICON_SVG);
}
