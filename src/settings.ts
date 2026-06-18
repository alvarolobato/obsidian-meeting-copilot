import { App, PluginSettingTab, Setting } from "obsidian";
import SystemRecordingPlugin from "./main";
import type { StoredTokens } from "./auth/googleOAuth";

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
        containerEl.empty();

        new Setting(containerEl)
            .setName("Recording folder")
            .setDesc("Folder in your vault to save recordings.")
            .addText((text) =>
                text
                    .setPlaceholder("Recordings")
                    .setValue(this.plugin.settings.recordingFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.recordingFolder = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("File name template")
            .setDesc(
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                "File name format. YYYY, MM, DD, HH, mm, ss are replaced with date and time."
            )
            .addText((text) =>
                text
                    // eslint-disable-next-line obsidianmd/ui/sentence-case
                    .setPlaceholder("Recording-YYYY-MM-DD-HHmmss")
                    .setValue(this.plugin.settings.fileNameTemplate)
                    .onChange(async (value) => {
                        this.plugin.settings.fileNameTemplate = value;
                        await this.plugin.saveSettings();
                    })
            );

		// eslint-disable-next-line obsidianmd/ui/sentence-case
		containerEl.createEl("h3", { text: "Google カレンダー連携" });

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("OAuth Client ID")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Google Cloud で作成した OAuth クライアントの Client ID。")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.googleClientId)
					.onChange(async (value) => {
						this.plugin.settings.googleClientId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("OAuth Client Secret")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("OAuth クライアントの Client Secret。")
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
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("Google 認証")
			.setDesc(
				this.plugin.isCalendarAuthenticated()
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					? "認証済み。再認証するとトークンを更新します。"
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					: "未認証。Client ID / Secret を設定してから認証してください。"
			)
			.addButton((btn) =>
				btn
					.setButtonText(
						// eslint-disable-next-line obsidianmd/ui/sentence-case
						this.plugin.isCalendarAuthenticated() ? "再認証" : "認証する"
					)
					.setCta()
					.onClick(async () => {
						await this.plugin.authenticateCalendar();
						this.display();
					})
			);

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("カレンダー自動録音")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("予定の開始時刻に録音開始の通知を出します。")
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
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("対象カレンダー ID")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("監視するカレンダーの ID。既定の primary はメインカレンダー。")
			.addText((text) =>
				text
					.setPlaceholder("primary")
					.setValue(this.plugin.settings.calendarId)
					.onChange(async (value) => {
						this.plugin.settings.calendarId = value.trim() || "primary";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("除外キーワード")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("タイトルにこれらの語を含む予定は録音しません（改行またはカンマ区切り、大文字小文字無視）。")
			.addTextArea((ta) =>
				ta
					.setValue(this.plugin.settings.exclusionKeywords)
					.onChange(async (value) => {
						this.plugin.settings.exclusionKeywords = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("Meet を自動で開く")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("予定の開始時刻に Google Meet リンクをブラウザで開きます。")
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
