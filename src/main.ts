import { Plugin } from "obsidian";
import { dragDropExtension } from "./dragDrop";

export default class ReorderablePlugin extends Plugin {
  async onload() {
    this.registerEditorExtension(dragDropExtension);
  }

  onunload() {}
}
