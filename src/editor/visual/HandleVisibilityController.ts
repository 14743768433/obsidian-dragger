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
    BLOCK_SELECTION_ACTIVE_CLASS,
} from '../core/constants';

const SELECTION_ANCHOR_HANDLE_CLASS = 'dnd-selection-anchor-handle';
const SELECTION_HIDDEN_HANDLE_CLASS = 'dnd-selection-handle-hidden';

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
        // Grab highlight is tied to an active drag gesture and must not persist after cleanup.
        this.selectionHighlight.clear();
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
     * Set ranges where handles should be hidden during block selection,
     * except for the anchor handle which remains visible.
     */
    setHiddenRangesForSelection(
        ranges: Array<{ startLineNumber: number; endLineNumber: number }>,
        anchorHandle: HTMLElement | null
    ): void {
        this.hiddenRangesForSelection = ranges;
        this.anchorHandleForSelection = anchorHandle;
        // Add body class to disable handle hover effects via CSS
        document.body.classList.add(BLOCK_SELECTION_ACTIVE_CLASS);
        this.reapplySelectionHandleVisibility();
        // Immediately show the anchor handle
        const anchor = this.getConnectedAnchorHandle();
        if (anchor) {
            this.setActiveVisibleHandle(anchor);
        }
    }

    /**
     * Clear the hidden ranges for selection and restore normal handle behavior.
     */
    clearHiddenRangesForSelection(): void {
        this.hiddenRangesForSelection = [];
        this.anchorHandleForSelection = null;
        // Remove body class to re-enable handle hover effects
        document.body.classList.remove(BLOCK_SELECTION_ACTIVE_CLASS);
        this.reapplySelectionHandleVisibility();
    }

    setActiveVisibleHandle(
        handle: HTMLElement | null,
        options?: { preserveHoveredLineNumber?: boolean }
    ): void {
        const preserveHoveredLineNumber = options?.preserveHoveredLineNumber === true;

        // If trying to set null but we have an anchor handle for selection, keep the anchor visible
        if (!handle && this.anchorHandleForSelection) {
            handle = this.anchorHandleForSelection;
        }

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

    reapplySelectionHandleVisibility(): void {
        const handles = Array.from(
            this.view.dom.querySelectorAll<HTMLElement>(`.${DRAG_HANDLE_CLASS}`)
        );
        const hasSelectionLock = this.hiddenRangesForSelection.length > 0;
        const anchorHandle = this.getConnectedAnchorHandle();
        for (const handle of handles) {
            if (!this.view.dom.contains(handle)) continue;
            if (!hasSelectionLock) {
                handle.classList.remove(SELECTION_ANCHOR_HANDLE_CLASS, SELECTION_HIDDEN_HANDLE_CLASS);
                continue;
            }
            if (anchorHandle && handle === anchorHandle) {
                handle.classList.add(SELECTION_ANCHOR_HANDLE_CLASS);
                handle.classList.remove(SELECTION_HIDDEN_HANDLE_CLASS);
                continue;
            }
            handle.classList.remove(SELECTION_ANCHOR_HANDLE_CLASS);
            handle.classList.add(SELECTION_HIDDEN_HANDLE_CLASS);
            if (this.activeHandle === handle) {
                handle.classList.remove('is-visible');
                this.activeHandle = null;
            }
        }
        if (!hasSelectionLock) return;
        if (anchorHandle) {
            anchorHandle.classList.add(SELECTION_ANCHOR_HANDLE_CLASS);
            anchorHandle.classList.remove(SELECTION_HIDDEN_HANDLE_CLASS);
            this.anchorHandleForSelection = anchorHandle;
            return;
        }
        this.anchorHandleForSelection = null;
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

        // When there's a selection, only anchor handle should be visible
        // All other handles should be hidden
        if (this.hiddenRangesForSelection.length > 0) {
            return null;
        }

        const directHandle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
        if (!directHandle) return null;
        if (this.view.dom.contains(directHandle)) {
            return directHandle;
        }
        return null;
    }

    resolveVisibleHandleFromPointerWhenLineNumbersHidden(clientX: number, clientY: number): HTMLElement | null {
        // When there's a selection, only anchor handle should be visible
        // All other handles should be hidden
        if (this.hiddenRangesForSelection.length > 0) {
            return null;
        }

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
        return this.resolveVisibleHandleForBlock(blockInfo);
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

    private getConnectedAnchorHandle(): HTMLElement | null {
        if (this.anchorHandleForSelection && this.anchorHandleForSelection.isConnected) {
            return this.anchorHandleForSelection;
        }
        if (this.hiddenRangesForSelection.length === 0) return null;
        const firstRange = this.hiddenRangesForSelection[0];
        if (!firstRange) return null;
        const blockStart = firstRange.startLineNumber - 1;
        const selector = `.${DRAG_HANDLE_CLASS}[data-block-start="${blockStart}"]`;
        const resolved = this.view.dom.querySelector<HTMLElement>(selector);
        return resolved ?? null;
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
