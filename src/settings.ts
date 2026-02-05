import { App, PluginSettingTab, Setting } from 'obsidian';
import DragNDropPlugin from './main';

export interface DragNDropSettings {
    // 是否在拖拽时显示预览
    showPreview: boolean;
    // 拖拽模式：move=移动, copy=复制
    defaultDragMode: 'move' | 'copy';
    // 是否启用跨文件拖拽
    enableCrossFileDrag: boolean;
}

export const DEFAULT_SETTINGS: DragNDropSettings = {
    showPreview: true,
    defaultDragMode: 'move',
    enableCrossFileDrag: false,
};

export class DragNDropSettingTab extends PluginSettingTab {
    plugin: DragNDropPlugin;

    constructor(app: App, plugin: DragNDropPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Drag n Drop 设置' });

        new Setting(containerEl)
            .setName('显示拖拽预览')
            .setDesc('拖拽时显示块内容预览')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showPreview)
                .onChange(async (value) => {
                    this.plugin.settings.showPreview = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('默认拖拽模式')
            .setDesc('默认情况下是移动还是复制块')
            .addDropdown(dropdown => dropdown
                .addOption('move', '移动')
                .addOption('copy', '复制')
                .setValue(this.plugin.settings.defaultDragMode)
                .onChange(async (value: 'move' | 'copy') => {
                    this.plugin.settings.defaultDragMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('启用跨文件拖拽')
            .setDesc('允许将块拖拽到其他文件（实验性功能）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableCrossFileDrag)
                .onChange(async (value) => {
                    this.plugin.settings.enableCrossFileDrag = value;
                    await this.plugin.saveSettings();
                }));
    }
}
