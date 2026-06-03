import {
  Decoration,
  DecorationSet,
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { Range } from "@codemirror/state";

const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)]) /;

// ── Drag handle widget ────────────────────────────────────────────────────────

class DragHandleWidget extends WidgetType {
  eq(other: DragHandleWidget) { return true; }

  toDOM() {
    const el = document.createElement("span");
    el.className = "reorderable-handle";
    el.setAttribute("aria-hidden", "true");
    el.draggable = true;
    el.textContent = "⠿";
    return el;
  }

  // Pass all events through so dragstart fires on the element
  ignoreEvent() { return false; }
}

// ── Drag state ────────────────────────────────────────────────────────────────

interface DragState {
  fromLine: number;   // 1-based line number in the doc
  indicator: HTMLElement;
}

let activeDrag: DragState | null = null;

// The handle the user grabbed — we need it to set activeDrag.fromLine in
// onDragstart, which fires after onMousedown on the handle.
let pendingFromLine: number | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBlock(view: EditorView, lineNo: number): string[] | null {
  const doc = view.state.doc;
  if (lineNo < 1 || lineNo > doc.lines) return null;
  const line = doc.line(lineNo);
  if (!LIST_ITEM_RE.test(line.text)) return null;

  const baseIndent = LIST_ITEM_RE.exec(line.text)![1].length;
  const lines: string[] = [line.text];

  for (let n = lineNo + 1; n <= doc.lines; n++) {
    const next = doc.line(n);
    if (next.text.trim() === "") break;
    const m = LIST_ITEM_RE.exec(next.text);
    if (m && m[1].length <= baseIndent) break;
    lines.push(next.text);
  }
  return lines;
}

function lineAtClientY(view: EditorView, y: number): number {
  const pos = view.posAtCoords({ x: 0, y }, false);
  return view.state.doc.lineAt(pos).number;
}

function positionIndicator(view: EditorView, indicator: HTMLElement, clientY: number) {
  const lineNo = lineAtClientY(view, clientY);
  const coords = view.coordsAtPos(view.state.doc.line(lineNo).from);
  if (!coords) return;
  const rect = view.scrollDOM.getBoundingClientRect();
  indicator.style.top = coords.top - rect.top + view.scrollDOM.scrollTop + "px";
}

function applyMove(view: EditorView, fromLine: number, toLine: number) {
  const doc = view.state.doc;
  const block = getBlock(view, fromLine);
  if (!block) return;

  const blockEnd = fromLine + block.length - 1;

  // Drop is within the dragged block itself — nothing to do
  if (toLine >= fromLine && toLine <= blockEnd) return;

  // Snapshot all lines as strings
  const allLines: string[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    allLines.push(doc.line(i).text);
  }

  // Remove the block from its current position
  allLines.splice(fromLine - 1, block.length);

  // Recalculate destination after removal
  let dest = toLine - 1; // convert to 0-based index
  if (toLine > blockEnd) dest -= block.length;
  dest = Math.max(0, Math.min(dest, allLines.length));

  // Insert the block at the destination
  allLines.splice(dest, 0, ...block);

  // Replace only the affected range (first touched line to last touched line)
  // so CM doesn't reset the viewport.
  const changedTop    = Math.min(fromLine - 1, dest);
  const changedBottom = Math.max(blockEnd - 1, dest + block.length - 1);
  const rangeFrom = doc.line(changedTop + 1).from;
  const rangeTo   = doc.line(Math.min(changedBottom + 1, doc.lines)).to;
  const newContent = allLines.slice(changedTop, changedBottom + 1).join("\n");

  const scrollTop = view.scrollDOM.scrollTop;
  view.dispatch(view.state.update({
    changes: { from: rangeFrom, to: rangeTo, insert: newContent },
  }));
  view.scrollDOM.scrollTop = scrollTop;
}

// ── ViewPlugin ────────────────────────────────────────────────────────────────

class ReorderPlugin implements PluginValue {
  decorations: DecorationSet;
  private cleanup: (() => void)[] = [];

  constructor(private view: EditorView) {
    this.decorations = this.buildDecorations(view);
    this.attachHandlers();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  destroy() {
    this.cleanup.forEach((fn) => fn());
    activeDrag?.indicator.remove();
    activeDrag = null;
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const widgets: Range<Decoration>[] = [];
    const { from, to } = view.viewport;
    const doc = view.state.doc;
    const handle = new DragHandleWidget();

    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (LIST_ITEM_RE.test(line.text)) {
        widgets.push(
          Decoration.widget({ widget: handle, side: -1 }).range(line.from)
        );
      }
      pos = line.to + 1;
    }

    return Decoration.set(widgets);
  }

  private attachHandlers() {
    const scroller = this.view.scrollDOM;

    // mousedown on a handle — record which line it belongs to
    const onMousedown = (e: MouseEvent) => {
      const handle = (e.target as HTMLElement).closest(".reorderable-handle");
      if (!handle) return;
      // Walk up to find the .cm-line, then ask CM for the line number
      const lineEl = handle.closest(".cm-line") as HTMLElement | null;
      if (!lineEl) return;
      // posAtDOM gives us a doc position; from that we get the line number
      try {
        const pos = this.view.posAtDOM(lineEl);
        pendingFromLine = this.view.state.doc.lineAt(pos).number;
      } catch {
        pendingFromLine = null;
      }
    };

    const onDragstart = (e: DragEvent) => {
      const handle = (e.target as HTMLElement).closest(".reorderable-handle");
      if (!handle || pendingFromLine === null) return;

      // Suppress browser's default "drag the text content" ghost
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        // Empty string so no text leaks into the drop target
        e.dataTransfer.setData("application/x-reorderable", String(pendingFromLine));
      }

      const indicator = document.createElement("div");
      indicator.className = "reorderable-indicator";
      scroller.appendChild(indicator);

      activeDrag = { fromLine: pendingFromLine, indicator };
      pendingFromLine = null;
    };

    const onDragover = (e: DragEvent) => {
      if (!activeDrag) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      positionIndicator(this.view, activeDrag.indicator, e.clientY);
    };

    const onDrop = (e: DragEvent) => {
      if (!activeDrag) return;
      e.preventDefault();
      activeDrag.indicator.remove();
      const toLine = lineAtClientY(this.view, e.clientY);
      applyMove(this.view, activeDrag.fromLine, toLine);
      activeDrag = null;
    };

    const onDragend = () => {
      activeDrag?.indicator.remove();
      activeDrag = null;
    };

    scroller.addEventListener("mousedown", onMousedown as EventListener);
    scroller.addEventListener("dragstart", onDragstart as EventListener);
    scroller.addEventListener("dragover", onDragover as EventListener);
    scroller.addEventListener("drop", onDrop as EventListener);
    scroller.addEventListener("dragend", onDragend);

    this.cleanup.push(() => {
      scroller.removeEventListener("mousedown", onMousedown as EventListener);
      scroller.removeEventListener("dragstart", onDragstart as EventListener);
      scroller.removeEventListener("dragover", onDragover as EventListener);
      scroller.removeEventListener("drop", onDrop as EventListener);
      scroller.removeEventListener("dragend", onDragend);
    });
  }
}

export const dragDropExtension = ViewPlugin.fromClass(ReorderPlugin, {
  decorations: (v) => v.decorations,
});
