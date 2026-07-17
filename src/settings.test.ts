import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, migrateSettings } from "./settings";
import { DEFAULT_ENRICH_PROMPT, effectiveEnrichPrompt } from "./enrich/prompt";

describe("migrateSettings", () => {
	it("derives the folder templates from a legacy meetingsFolder", () => {
		const migrated = migrateSettings({ meetingsFolder: "Work/Meetings" });
		expect(migrated.oneOffFolderTemplate).toBe("Work/Meetings");
		expect(migrated.seriesFolderTemplate).toBe("Work/Meetings/{{series}}");
	});

	it("nests ad-hoc notes and 1:1s under the legacy folder", () => {
		const migrated = migrateSettings({ meetingsFolder: "Work/Meetings" });
		expect(migrated.adhocFolder).toBe("Work/Meetings/Ad-hoc");
		expect(migrated.oneOnOneFolder).toBe("Work/Meetings/1-1s");
	});

	it("falls back to \"Meetings\" when meetingsFolder is missing or empty", () => {
		expect(migrateSettings({}).oneOffFolderTemplate).toBe("Meetings");
		expect(migrateSettings({ meetingsFolder: "" }).oneOffFolderTemplate).toBe(
			"Meetings"
		);
		expect(migrateSettings({}).adhocFolder).toBe("Meetings/Ad-hoc");
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

	it("drops a null folder template on the passthrough branch so the default wins", () => {
		const migrated = migrateSettings({ oneOffFolderTemplate: null });
		expect(migrated).not.toHaveProperty("oneOffFolderTemplate");
		expect(
			Object.assign({}, DEFAULT_SETTINGS, migrated).oneOffFolderTemplate
		).toBe(DEFAULT_SETTINGS.oneOffFolderTemplate);
	});

	it("drops an empty-string folder template so the default wins", () => {
		const migrated = migrateSettings({
			oneOffFolderTemplate: "Meetings/{{year}}",
			seriesFolderTemplate: "",
		});
		expect(migrated).not.toHaveProperty("seriesFolderTemplate");
		expect(
			Object.assign({}, DEFAULT_SETTINGS, migrated).seriesFolderTemplate
		).toBe(DEFAULT_SETTINGS.seriesFolderTemplate);
	});

	it("drops a numeric folder template so the default wins", () => {
		const migrated = migrateSettings({
			oneOffFolderTemplate: "Meetings/{{year}}",
			adhocFolder: 42,
		});
		expect(migrated).not.toHaveProperty("adhocFolder");
		expect(Object.assign({}, DEFAULT_SETTINGS, migrated).adhocFolder).toBe(
			DEFAULT_SETTINGS.adhocFolder
		);
	});

	it("drops a non-boolean oneOnOneSeparately so the default wins", () => {
		const migrated = migrateSettings({
			oneOffFolderTemplate: "Meetings/{{year}}",
			oneOnOneSeparately: "yes",
		});
		expect(migrated).not.toHaveProperty("oneOnOneSeparately");
		expect(
			Object.assign({}, DEFAULT_SETTINGS, migrated).oneOnOneSeparately
		).toBe(DEFAULT_SETTINGS.oneOnOneSeparately);
	});

	it("keeps a valid oneOffFolderTemplate untouched", () => {
		const migrated = migrateSettings({ oneOffFolderTemplate: "Custom/{{year}}" });
		expect(migrated.oneOffFolderTemplate).toBe("Custom/{{year}}");
	});

	// The prompt is no longer persisted as a full copy of the default; a legacy
	// stored enrichPrompt is dropped so every non-customizing vault resolves to
	// the live default (effectiveEnrichPrompt) — the whole point of the toggle.
	it("drops a legacy persisted enrichPrompt so the live default wins", () => {
		const migrated = migrateSettings({
			oneOffFolderTemplate: "Meetings",
			enrichPrompt: "an old persisted default without actionItems",
		});
		expect(migrated).not.toHaveProperty("enrichPrompt");
		const settings = Object.assign({}, DEFAULT_SETTINGS, migrated);
		expect(settings.enrichPromptCustomize).toBe(false);
		expect(
			effectiveEnrichPrompt(
				settings.enrichPromptCustomize,
				settings.enrichPrompt
			)
		).toBe(DEFAULT_ENRICH_PROMPT);
	});

	it("drops the legacy enrichPrompt on the legacy meetingsFolder branch too", () => {
		const migrated = migrateSettings({
			meetingsFolder: "Work/Meetings",
			enrichPrompt: "old default",
		});
		expect(migrated.oneOffFolderTemplate).toBe("Work/Meetings");
		expect(migrated).not.toHaveProperty("enrichPrompt");
	});

	it("keeps a stored custom prompt when the customize toggle is on", () => {
		const custom = "Custom prompt with {{notes}} and {{transcript}}.";
		const migrated = migrateSettings({
			oneOffFolderTemplate: "Meetings",
			enrichPromptCustomize: true,
			enrichPrompt: custom,
		});
		expect(migrated.enrichPrompt).toBe(custom);
		const settings = Object.assign({}, DEFAULT_SETTINGS, migrated);
		expect(
			effectiveEnrichPrompt(
				settings.enrichPromptCustomize,
				settings.enrichPrompt
			)
		).toBe(custom);
	});

	// New-format vault (the toggle key exists) with customize OFF: the stored
	// custom text is preserved across reloads — only legacy vaults (no key) are
	// reset — so toggling off then back on doesn't lose the user's prompt.
	it("keeps stored custom text when the toggle key exists but is off", () => {
		const custom = "leftover custom prompt";
		const migrated = migrateSettings({
			oneOffFolderTemplate: "Meetings",
			enrichPromptCustomize: false,
			enrichPrompt: custom,
		});
		expect(migrated.enrichPrompt).toBe(custom);
		// Still resolves to the default while off…
		expect(effectiveEnrichPrompt(false, custom)).toBe(DEFAULT_ENRICH_PROMPT);
		// …and comes back verbatim when re-enabled.
		expect(effectiveEnrichPrompt(true, custom)).toBe(custom);
	});

	it("drops legacy noteTemplate / noteTitlePattern on the meetingsFolder branch too", () => {
		const migrated = migrateSettings({
			meetingsFolder: "Work/Meetings",
			noteTemplate: "# old",
			noteTitlePattern: "old pattern",
		});
		expect(migrated.oneOffFolderTemplate).toBe("Work/Meetings");
		expect(migrated).not.toHaveProperty("noteTemplate");
		expect(migrated).not.toHaveProperty("noteTitlePattern");
	});

	it("does not add enrichPrompt when it was not persisted", () => {
		const migrated = migrateSettings({ oneOffFolderTemplate: "Meetings" });
		expect(migrated).not.toHaveProperty("enrichPrompt");
	});

	// Same "live default vs stored custom" model for the note template and
	// title pattern: a legacy persisted copy is dropped unless the user opted in.
	it("drops legacy persisted noteTemplate / noteTitlePattern", () => {
		const migrated = migrateSettings({
			oneOffFolderTemplate: "Meetings",
			noteTemplate: "# old template",
			noteTitlePattern: "old pattern",
		});
		expect(migrated).not.toHaveProperty("noteTemplate");
		expect(migrated).not.toHaveProperty("noteTitlePattern");
		const settings = Object.assign({}, DEFAULT_SETTINGS, migrated);
		expect(settings.noteTemplateCustomize).toBe(false);
		expect(settings.noteTitlePatternCustomize).toBe(false);
	});

	it("keeps a stored noteTemplate / noteTitlePattern when their toggle is on", () => {
		const migrated = migrateSettings({
			oneOffFolderTemplate: "Meetings",
			noteTemplateCustomize: true,
			noteTemplate: "# {{title}} custom",
			noteTitlePatternCustomize: true,
			noteTitlePattern: "{{title}}",
		});
		expect(migrated.noteTemplate).toBe("# {{title}} custom");
		expect(migrated.noteTitlePattern).toBe("{{title}}");
	});
});
