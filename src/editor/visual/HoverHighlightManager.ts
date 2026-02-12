import { EditorView } from '@codemirror/view';
import { SELECTION_HIGHLIGHT_LINE_CLASS } from '../core/selectors';

/**
 * Manages the selection highlight on `.cm-line` elements
 * for the currently grabbed / single-block-selected range.
 *
 * Tracks the highlighted line range so the class can be re-applied
 * after CM6 DOM updates (which may reset element classes).
 */
export class SelectionHighlightManager {
    private readonly highlightedEls = new Set<HTMLElement>();
    private activeRange: { start: number; end: number } | null = null;

    highlight(view: EditorView, startLineNumber: number, endLineNumber: number): void {
        this.removeClassFromElements();
        this.activeRange = { start: startLineNumber, end: endLineNumber };
        this.applyToDOM(view);
    }

    clear(): void {
        this.removeClassFromElements();
        this.activeRange = null;
    }

    /** Re-apply after CM6 view update that may have replaced DOM elements. */
    reapply(view: EditorView): void {
        if (!this.activeRange) return;
        this.removeClassFromElements();
        this.applyToDOM(view);
    }

    destroy(): void {
        this.clear();
    }

    private applyToDOM(view: EditorView): void {
        if (!this.activeRange) return;
        const doc = view.state.doc;
        const from = Math.max(1, Math.min(doc.lines, this.activeRange.start));
        const to = Math.max(1, Math.min(doc.lines, this.activeRange.end));
        for (let lineNumber = from; lineNumber <= to; lineNumber++) {
            const lineEl = this.getLineElementForLine(view, lineNumber);
            if (!lineEl) continue;
            lineEl.classList.add(SELECTION_HIGHLIGHT_LINE_CLASS);
            this.highlightedEls.add(lineEl);
        }
    }

    private removeClassFromElements(): void {
        for (const el of this.highlightedEls) {
            el.classList.remove(SELECTION_HIGHLIGHT_LINE_CLASS);
        }
        this.highlightedEls.clear();
    }

    private getLineElementForLine(view: EditorView, lineNumber: number): HTMLElement | null {
        if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
        if (typeof view.domAtPos !== 'function') return null;
        try {
            const line = view.state.doc.line(lineNumber);
            const domAtPos = view.domAtPos(line.from);
            const base = domAtPos.node.nodeType === Node.TEXT_NODE
                ? domAtPos.node.parentElement
                : domAtPos.node;
            if (!(base instanceof Element)) return null;
            return base.closest<HTMLElement>('.cm-line') ?? null;
        } catch {
            return null;
        }
    }
}
