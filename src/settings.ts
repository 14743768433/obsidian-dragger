import { App, PluginSettingTab, Setting } from 'obsidian';
import DragNDropPlugin from './main';

export interface DragNDropSettings {
    // 抓取手柄颜色模式
    handleColorMode: 'theme' | 'custom';
    // 抓取手柄颜色（自定义时生效）
    handleColor: string;
    // 是否常态显示手柄
    alwaysShowHandles: boolean;
    // 定位栏颜色模式
    indicatorColorMode: 'theme' | 'custom';
    // 定位栏颜色（自定义时生效）
    indicatorColor: string;
    // 是否启用跨文件拖拽
    enableCrossFileDrag: boolean;
    // 是否启用多行选取拖拽
    enableMultiLineSelection: boolean;
    // 手柄横向偏移量（像素）
    handleHorizontalOffsetPx: number;
}

export const DEFAULT_SETTINGS: DragNDropSettings = {
    handleColorMode: 'theme',
    handleColor: '#8a8a8a',
    alwaysShowHandles: false,
    indicatorColorMode: 'theme',
    indicatorColor: '#7a7a7a',
    enableCrossFileDrag: false,
    enableMultiLineSelection: true,
    handleHorizontalOffsetPx: 0,
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

        containerEl.createEl('h2', { text: 'Dragger 设置' });

        containerEl.createEl('h3', { text: '样式' });

        const colorSetting = new Setting(containerEl)
            .setName('抓取手柄颜色')
            .setDesc('可跟随主题色，或自定义颜色（选择自定义时生效）');

        colorSetting.addDropdown(dropdown => dropdown
            .addOption('theme', '跟随主题色')
            .addOption('custom', '自定义')
            .setValue(this.plugin.settings.handleColorMode)
            .onChange(async (value: 'theme' | 'custom') => {
                this.plugin.settings.handleColorMode = value;
                await this.plugin.saveSettings();
            }));

        colorSetting.addColorPicker(picker => picker
            .setValue(this.plugin.settings.handleColor)
            .onChange(async (value) => {
                this.plugin.settings.handleColor = value;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('始终显示拖拽手柄')
            .setDesc('开启后不需要悬停也能看到手柄')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.alwaysShowHandles)
                .onChange(async (value) => {
                    this.plugin.settings.alwaysShowHandles = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('手柄横向位置')
            .setDesc('向左为负值，向右为正值')
            .addSlider((slider) => slider
                .setLimits(-80, 80, 1)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.handleHorizontalOffsetPx)
                .onChange(async (value) => {
                    this.plugin.settings.handleHorizontalOffsetPx = value;
                    await this.plugin.saveSettings();
                }));

        const indicatorSetting = new Setting(containerEl)
            .setName('定位栏颜色')
            .setDesc('可跟随主题色，或自定义颜色（选择自定义时生效）');

        indicatorSetting.addDropdown(dropdown => dropdown
            .addOption('theme', '跟随主题色')
            .addOption('custom', '自定义')
            .setValue(this.plugin.settings.indicatorColorMode)
            .onChange(async (value: 'theme' | 'custom') => {
                this.plugin.settings.indicatorColorMode = value;
                await this.plugin.saveSettings();
            }));

        indicatorSetting.addColorPicker(picker => picker
            .setValue(this.plugin.settings.indicatorColor)
            .onChange(async (value) => {
                this.plugin.settings.indicatorColor = value;
                await this.plugin.saveSettings();
            }));

        containerEl.createEl('h3', { text: '功能' });
        new Setting(containerEl)
            .setName('开启多行选取')
            .setDesc('关闭后仅保留单块拖拽，不进入多行选取流程')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMultiLineSelection)
                .onChange(async (value) => {
                    this.plugin.settings.enableMultiLineSelection = value;
                    await this.plugin.saveSettings();
                }));

        // Cross-file drag remains disabled in this release.
        // Keep the persisted setting key for backward compatibility, but hide it from UI.
    }
}
