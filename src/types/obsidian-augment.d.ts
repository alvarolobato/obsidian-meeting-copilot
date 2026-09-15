import type { Menu } from "obsidian";

declare module "obsidian" {
	interface MenuItem {
		/**
		 * Turns this item into a submenu and returns the child Menu. Present in
		 * the Obsidian runtime (1.4+) but missing from the bundled typings.
		 */
		setSubmenu(): Menu;
	}
}
