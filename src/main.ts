import { Plugin, PluginSettingTab, App, Setting } from "obsidian";
import { dragDropExtension, setSettings } from "./dragDrop";

export type HandlePosition = "beginning" | "next-to-bullet";

export interface ReorderableSettings {
  ghostImage: boolean;
  handlePosition: HandlePosition;
  handleOffset: number;
  handleOffsetWithChildren: number;
}

const DEFAULT_SETTINGS: ReorderableSettings = {
  ghostImage: true,
  handlePosition: "beginning",
  handleOffset: 1.4,
  handleOffsetWithChildren: 2.2,
};

export default class ReorderablePlugin extends Plugin {
  settings: ReorderableSettings;

  async onload() {
    await this.loadSettings();
    this.registerEditorExtension(dragDropExtension);
    this.addSettingTab(new ReorderableSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    setSettings(this.settings);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    setSettings(this.settings);
  }

  onunload() {}
}

class ReorderableSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ReorderablePlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Ghost image")
      .setDesc("Show a semi-transparent preview of the item while dragging.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.ghostImage)
          .onChange(async (value) => {
            this.plugin.settings.ghostImage = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Handle position")
      .setDesc("Where to show the drag handle on list items.")
      .addDropdown((drop) =>
        drop
          .addOption("beginning", "Before line content")
          .addOption("next-to-bullet", "Before bullet marker")
          .setValue(this.plugin.settings.handlePosition)
          .onChange(async (value) => {
            this.plugin.settings.handlePosition = value as HandlePosition;
            await this.plugin.saveSettings();
            const show = value === "next-to-bullet";
            offsetSetting.settingEl.toggle(show);
            offsetWithChildrenSetting.settingEl.toggle(show);
          })
      );

    const offsetSetting = new Setting(containerEl)
      .setName("Handle offset")
      .setDesc("Gap (in em) between the handle and the bullet marker.")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 3, 0.1)
          .setValue(this.plugin.settings.handleOffset)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.handleOffset = value;
            await this.plugin.saveSettings();
          })
      );

    const offsetWithChildrenSetting = new Setting(containerEl)
      .setName("Handle offset (items with sub-items)")
      .setDesc("Gap (in em) for items that have children, which show a collapse arrow (›).")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 3, 0.1)
          .setValue(this.plugin.settings.handleOffsetWithChildren)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.handleOffsetWithChildren = value;
            await this.plugin.saveSettings();
          })
      );

    const isInline = this.plugin.settings.handlePosition === "next-to-bullet";
    offsetSetting.settingEl.toggle(isInline);
    offsetWithChildrenSetting.settingEl.toggle(isInline);
  }
}
