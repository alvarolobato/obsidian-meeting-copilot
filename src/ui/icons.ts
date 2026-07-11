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
<rect x="15.5" y="11" width="4" height="6" rx="2"/>
<path d="M13.5 15.5v1a4 4 0 0 0 8 0v-1"/>
<path d="M17.5 20.5V22"/>
</g>`;

/** Registers Meeting Copilot's custom icons. Call once during plugin load. */
export function registerIcons(): void {
	addIcon(RECORD_ICON, RECORD_ICON_SVG);
}
