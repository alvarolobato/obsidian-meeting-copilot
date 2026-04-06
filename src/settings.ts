import { App, PluginSettingTab, Setting } from "obsidian";
import SystemRecordingPlugin from "./main";

export interface SystemRecordingSettings {
    recordingFolder: string;
    fileNameTemplate: string;
}

export const DEFAULT_SETTINGS: SystemRecordingSettings = {
    recordingFolder: "recordings",
    fileNameTemplate: "recording-YYYY-MM-DD-HHmmss",
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
    }
}
