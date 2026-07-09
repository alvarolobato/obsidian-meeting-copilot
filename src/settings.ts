import { App, PluginSettingTab, Setting } from "obsidian";
import SystemRecordingPlugin from "./main";
import type { StoredTokens } from "./auth/googleOAuth";
import { t } from "./i18n";

export interface SystemRecordingSettings {
	recordingFolder: string;
	fileNameTemplate: string;
	googleClientId: string;
	googleClientSecret: string;
	googleTokens: StoredTokens | null;
	calendarAutoRecord: boolean;
	calendarId: string;
	exclusionKeywords: string;
	openMeetAutomatically: boolean;
}

export const DEFAULT_SETTINGS: SystemRecordingSettings = {
	recordingFolder: "recordings",
	fileNameTemplate: "recording-YYYY-MM-DD-HHmmss",
	googleClientId: "",
	googleClientSecret: "",
	googleTokens: null,
	calendarAutoRecord: false,
	calendarId: "primary",
	exclusionKeywords: "",
	openMeetAutomatically: true,
};

export class SystemRecordingSettingTab extends PluginSettingTab {
    plugin: SystemRecordingPlugin;

    constructor(app: App, plugin: SystemRecordingPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        const s = t();
        containerEl.empty();

        new Setting(containerEl)
            .setName(s.settings.recordingFolder.name)
            .setDesc(s.settings.recordingFolder.desc)
            .addText((text) =>
                text
                    .setPlaceholder(s.settings.recordingFolder.placeholder)
                    .setValue(this.plugin.settings.recordingFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.recordingFolder = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.fileNameTemplate.name)
            .setDesc(s.settings.fileNameTemplate.desc)
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.fileNameTemplate)
                    .onChange(async (value) => {
                        this.plugin.settings.fileNameTemplate = value;
                        await this.plugin.saveSettings();
                    })
            );

		new Setting(containerEl).setName(s.settings.calendarHeading).setHeading();

		new Setting(containerEl)
			.setName(s.settings.clientId.name)
			.setDesc(s.settings.clientId.desc)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.googleClientId)
					.onChange(async (value) => {
						this.plugin.settings.googleClientId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(s.settings.clientSecret.name)
			.setDesc(s.settings.clientSecret.desc)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setValue(this.plugin.settings.googleClientSecret)
					.onChange(async (value) => {
						this.plugin.settings.googleClientSecret = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(s.settings.googleAuth.name)
			.setDesc(
				this.plugin.isCalendarAuthenticated()
					? s.settings.googleAuth.descAuthenticated
					: s.settings.googleAuth.descUnauthenticated
			)
			.addButton((btn) =>
				btn
					.setButtonText(
						this.plugin.isCalendarAuthenticated()
							? s.settings.googleAuth.buttonReauthenticate
							: s.settings.googleAuth.buttonAuthenticate
					)
					.setCta()
					.onClick(async () => {
						await this.plugin.authenticateCalendar();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName(s.settings.calendarAutoRecord.name)
			.setDesc(s.settings.calendarAutoRecord.desc)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.calendarAutoRecord)
					.onChange(async (value) => {
						this.plugin.settings.calendarAutoRecord = value;
						await this.plugin.saveSettings();
						this.plugin.updateScheduler();
					})
			);

		new Setting(containerEl)
			.setName(s.settings.targetCalendarId.name)
			.setDesc(s.settings.targetCalendarId.desc)
			.addText((text) => {
				text
					.setValue(this.plugin.settings.calendarId)
					.onChange(async (value) => {
						this.plugin.settings.calendarId = value.trim() || "primary";
						await this.plugin.saveSettings();
					});
				// Re-poll immediately once the user finishes editing (avoids per-keystroke API calls).
				this.plugin.registerDomEvent(text.inputEl, "blur", () => {
					this.plugin.refreshCalendarNow();
				});
			});

		new Setting(containerEl)
			.setName(s.settings.exclusionKeywords.name)
			.setDesc(s.settings.exclusionKeywords.desc)
			.addTextArea((ta) =>
				ta
					.setValue(this.plugin.settings.exclusionKeywords)
					.onChange(async (value) => {
						this.plugin.settings.exclusionKeywords = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(s.settings.openMeet.name)
			.setDesc(s.settings.openMeet.desc)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openMeetAutomatically)
					.onChange(async (value) => {
						this.plugin.settings.openMeetAutomatically = value;
						await this.plugin.saveSettings();
					})
			);
    }
}
