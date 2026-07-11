import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, migrateSettings } from "./settings";

describe("migrateSettings", () => {
	it("derives the folder templates from a legacy meetingsFolder", () => {
		const migrated = migrateSettings({ meetingsFolder: "Work/Meetings" });
		expect(migrated.oneOffFolderTemplate).toBe("Work/Meetings");
		expect(migrated.seriesFolderTemplate).toBe("Work/Meetings/{{series}}");
	});

	it("keeps ad-hoc notes at the legacy folder itself, and nests 1:1s under it", () => {
		const migrated = migrateSettings({ meetingsFolder: "Work/Meetings" });
		expect(migrated.adhocFolder).toBe("Work/Meetings");
		expect(migrated.oneOnOneFolder).toBe("Work/Meetings/1-1s");
	});

	it("falls back to \"Meetings\" when meetingsFolder is missing or empty", () => {
		expect(migrateSettings({}).oneOffFolderTemplate).toBe("Meetings");
		expect(migrateSettings({ meetingsFolder: "" }).oneOffFolderTemplate).toBe(
			"Meetings"
		);
		expect(migrateSettings({}).adhocFolder).toBe("Meetings");
		expect(migrateSettings({}).oneOnOneFolder).toBe("Meetings/1-1s");
	});

	it("leaves data that already has the new templates untouched", () => {
		const loaded = {
			oneOffFolderTemplate: "Custom/{{year}}",
			seriesFolderTemplate: "Custom/{{series}}",
			meetingsFolder: "Ignored",
		};
		expect(migrateSettings(loaded)).toEqual(loaded);
	});

	it("returns no overrides for null/fresh data, so defaults apply", () => {
		const migrated = migrateSettings(null);
		expect(migrated).toEqual({});
		expect(
			Object.assign({}, DEFAULT_SETTINGS, migrated).oneOffFolderTemplate
		).toBe(DEFAULT_SETTINGS.oneOffFolderTemplate);
	});
});
