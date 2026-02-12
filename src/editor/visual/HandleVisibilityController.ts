import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import {
    getLineNumberElementForLine,
    hasVisibleLineNumberGutter,
} from '../core/handle-position';
import { DRAG_HANDLE_CLASS } from '../core/selectors';
import { SelectionHighlightManager } from './HoverHighlightManager';
import {
    HANDLE_INTERACTION_ZONE_PX,
    HOVER_HIDDEN_LINE_NUMBER_CLASS,
    GRAB_HIDDEN_LINE_NUMBER_CLASS,
} from '../core/constants';

export interface HandleVisibilityDeps {
    getBlockInfoForHandle: (handle: HTMLElement) => BlockInfo | null;
    getDraggableBlockAtPoint: (clientX: number, clientY: number) => BlockInfo | null;
}

export class HandleVisibilityController {
    private hiddenHoveredLineNumberEl: HTMLElement | null = null;
    private currentHoveredLineNumber: number | null = null;
    private readonly hiddenGrabbedLineNumberEls = new Set<HTMLElement>();
    private activeHandle: HTMLElement | null = null;
    private readonly selectionHighlight = new SelectionHighlightManager();
    // For smart block selection: hide handles in these ranges except the anchor
    private hiddenRangesForSelection: Array<{ startLineNumber: number; endLineNumber: number }> = [];
    private anchorHandleForSelection: HTMLElement | null = null;

    constructor(
        private readonly view: EditorView,
        private readonly deps: HandleVisibilityDeps
    ) { }

    getActiveHandle(): HTMLElement | null {
        return this.activeHandle;
    }

    clearHoveredLineNumber(): void {
        if (this.hiddenHoveredLineNumberEl) {
            this.hiddenHoveredLineNumberEl.classList.remove(HOVER_HIDDEN_LINE_NUMBER_CLASS);
        }
        this.hiddenHoveredLineNumberEl = null;
        this.currentHoveredLineNumber = null;
    }

    clearGrabbedLineNumbers(): void {
        for (const lineNumberEl of this.hiddenGrabbedLineNumberEls) {
            lineNumberEl.classList.remove(GRAB_HIDDEN_LINE_NUMBER_CLASS);
        }
        this.hiddenGrabbedLineNumberEls.clear();
    }

    setGrabbedLineNumberRange(startLineNumber: number, endLineNumber: number): void {
        this.clearGrabbedLineNumbers();
        if (!hasVisibleLineNumberGutter(this.view)) return;
        const safeStart = Math.max(1, Math.min(this.view.state.doc.lines, startLineNumber));
        const safeEnd = Math.max(1, Math.min(this.view.state.doc.lines, endLineNumber));
        const from = Math.min(safeStart, safeEnd);
        const to = Math.max(safeStart, safeEnd);
        for (let lineNumber = from; lineNumber <= to; lineNumber++) {
            const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
            if (!lineNumberEl) continue;
            lineNumberEl.classList.add(GRAB_HIDDEN_LINE_NUMBER_CLASS);
            this.hiddenGrabbedLineNumberEls.add(lineNumberEl);
        }
    }

    /**
     * Set ranges where handles should be hidden during smart block selection,
     * except for the anchor handle which remains visible.
     */
    setHiddenRangesForSelection(
        ranges: Array<{ startLineNumber: number; endLineNumber: number }>,
        anchorHandle: HTMLElement | null
    ): void {
        this.hiddenRangesForSelection = ranges;
        this.anchorHandleForSelection = anchorHandle;
    }

    /**
     * Clear the hidden ranges for selection.
     */
    clearHiddenRangesForSelection(): void {
        this.hiddenRangesForSelection = [];
        this.anchorHandleForSelection = null;
    }

    /**
     * Check if a handle should be hidden based on selection ranges.
     * Returns true if the handle is within a hidden range and is not the anchor.
     */
    private isHandleHiddenBySelection(handle: HTMLElement): boolean {
        if (this.hiddenRangesForSelection.length === 0) return false;
        if (handle === this.anchorHandleForSelection) return false;

        const lineNumber = this.resolveHandleLineNumber(handle);
        if (lineNumber === null) return false;

        for (const range of this.hiddenRangesForSelection) {
            if (lineNumber >= range.startLineNumber && lineNumber <= range.endLineNumber) {
                return true;
            }
        }
        return false;
    }

    setActiveVisibleHandle(
        handle: HTMLElement | null,
        options?: { preserveHoveredLineNumber?: boolean }
    ): void {
        const preserveHoveredLineNumber = options?.preserveHoveredLineNumber === true;
        if (this.activeHandle === handle) {
            if (!handle && !preserveHoveredLineNumber) {
                this.clearHoveredLineNumber();
            }
            return;
        }
        if (this.activeHandle) {
            this.activeHandle.classList.remove('is-visible');
        }

        this.activeHandle = handle;
        if (!handle) {
            if (!preserveHoveredLineNumber) {
                this.clearHoveredLineNumber();
            }
            return;
        }

        handle.classList.add('is-visible');
        if (!preserveHoveredLineNumber) {
            const lineNumber = this.resolveHandleLineNumber(handle);
            if (!lineNumber) {
                this.clearHoveredLineNumber();
                return;
            }
            this.setHoveredLineNumber(lineNumber);
        }
    }

    enterGrabVisualState(
        startLineNumber: number,
        endLineNumber: number,
        handle: HTMLElement | null
    ): void {
        this.setActiveVisibleHandle(
            handle,
            { preserveHoveredLineNumber: true }
        );
        this.clearHoveredLineNumber();
        this.setGrabbedLineNumberRange(startLineNumber, endLineNumber);
        this.selectionHighlight.highlight(this.view, startLineNumber, endLineNumber);
    }

    clearSelectionHighlight(): void {
        this.selectionHighlight.clear();
    }

    reapplySelectionHighlight(): void {
        this.selectionHighlight.reapply(this.view);
    }

    isPointerInHandleInteractionZone(clientX: number, clientY: number): boolean {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        if (clientY < contentRect.top || clientY > contentRect.bottom) return false;
        const leftBound = contentRect.left - HANDLE_INTERACTION_ZONE_PX;
        const rightBound = contentRect.left + HANDLE_INTERACTION_ZONE_PX;
        return clientX >= leftBound && clientX <= rightBound;
    }

    resolveVisibleHandleFromTarget(target: EventTarget | null): HTMLElement | null {
        if (!(target instanceof HTMLElement)) return null;

        const directHandle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
        if (!directHandle) return null;
        if (this.view.dom.contains(directHandle)) {
            // Don't show handles that are hidden by selection
            if (this.isHandleHiddenBySelection(directHandle)) {
                return null;
            }
            return directHandle;
        }
        return null;
    }

    resolveVisibleHandleFromPointerWhenLineNumbersHidden(clientX: number, clientY: number): HTMLElement | null {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        if (
            clientX < contentRect.left
            || clientX > contentRect.right
            || clientY < contentRect.top
            || clientY > contentRect.bottom
        ) {
            return null;
        }

        const blockInfo = this.deps.getDraggableBlockAtPoint(clientX, clientY);
        if (!blockInfo) return null;
        const handle = this.resolveVisibleHandleForBlock(blockInfo);
        // Don't show handles that are hidden by selection
        if (handle && this.isHandleHiddenBySelection(handle)) {
            return null;
        }
        return handle;
    }

    resolveHandleLineNumber(handle: HTMLElement): number | null {
        const startAttr = handle.getAttribute('data-block-start');
        if (startAttr !== null) {
            const lineNumber = Number(startAttr) + 1;
            if (Number.isInteger(lineNumber) && lineNumber >= 1 && lineNumber <= this.view.state.doc.lines) {
                return lineNumber;
            }
        }

        const blockInfo = this.deps.getBlockInfoForHandle(handle);
        if (!blockInfo) return null;
        const lineNumber = blockInfo.startLine + 1;
        if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > this.view.state.doc.lines) {
            return null;
        }
        return lineNumber;
    }

    private resolveVisibleHandleForBlock(blockInfo: BlockInfo): HTMLElement | null {
        const selector = `.${DRAG_HANDLE_CLASS}[data-block-start="${blockInfo.startLine}"]`;
        const candidates = Array.from(this.view.dom.querySelectorAll<HTMLElement>(selector));
        if (candidates.length === 0) return null;

        return candidates[0] ?? null;
    }

    private setHoveredLineNumber(lineNumber: number): void {
        if (this.currentHoveredLineNumber === lineNumber && this.hiddenHoveredLineNumberEl) {
            return;
        }
        const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
        if (!lineNumberEl) {
            this.clearHoveredLineNumber();
            return;
        }
        this.clearHoveredLineNumber();
        lineNumberEl.classList.add(HOVER_HIDDEN_LINE_NUMBER_CLASS);
        this.hiddenHoveredLineNumberEl = lineNumberEl;
        this.currentHoveredLineNumber = lineNumber;
    }
}
