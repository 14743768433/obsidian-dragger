import { Plugin } from 'obsidian';
import { dragHandleExtension } from './editor/drag-handle';
import { DragNDropSettings, DEFAULT_SETTINGS, DragNDropSettingTab } from './settings';

export default class DragNDropPlugin extends Plugin {
    settings: DragNDropSettings;

    async onload() {
        console.log('Loading Drag n Drop plugin');

        await this.loadSettings();

        // 注册编辑器扩展
        this.registerEditorExtension(dragHandleExtension(this));

        // 添加设置面板
        this.addSettingTab(new DragNDropSettingTab(this.app, this));
    }

    onunload() {
        console.log('Unloading Drag n Drop plugin');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
