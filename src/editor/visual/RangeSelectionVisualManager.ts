import { EditorView } from '@codemirror/view';
import { LineRange } from '../../types';
import {
    getHandleColumnCenterX,
    getLineNumberElementForLine,
    viewportXToEditorLocalX,
    viewportYToEditorLocalY,
} from '../core/handle-position';
import {
    DRAG_HANDLE_CLASS,
    RANGE_SELECTED_LINE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
    RANGE_SELECTION_LINK_CLASS,
    EMBED_HANDLE_CLASS,
} from '../core/selectors';
import { GRAB_HIDDEN_LINE_NUMBER_CLASS } from '../core/constants';

const RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS = GRAB_HIDDEN_LINE_NUMBER_CLASS;
const LINE_RESOLUTION_RETRY_DELAY_MS = 32;
const MAX_LINE_RESOLUTION_RETRIES = 3;

export class RangeSelectionVisualManager {
    private readonly lineElements = new Set<HTMLElement>();
    private readonly lineNumberElements = new Set<HTMLElement>();
    private readonly handleElements = new Set<HTMLElement>();
    private readonly linkEls: HTMLElement[] = [];
    private refreshRafHandle: number | null = null;
    private scrollContainer: HTMLElement | null = null;
    private readonly onScroll: () => void;
    private lineResolutionRetryHandle: number | null = null;
    private lineResolutionRetryCount = 0;

    constructor(
        private readonly view: EditorView,
        private readonly onRefreshRequested: () => void
    ) {
        this.onScroll = () => this.scheduleRefresh();
        this.bindScrollListener();
    }

    render(ranges: LineRange[], options?: { showLinks?: boolean; highlightHandles?: boolean }): void {
        const showLinks = options?.showLinks ?? true;
        const highlightHandles = options?.highlightHandles ?? true;
        console.log('[Dragger Debug] RangeSelectionVisualManager.render', {
            ranges: JSON.stringify(ranges),
            showLinks,
            highlightHandles,
        });
        const normalizedRanges = this.mergeLineRanges(ranges);
        const nextLineElements = new Set<HTMLElement>();
        const nextLineNumberElements = new Set<HTMLElement>();
        const nextHandleElements = new Set<HTMLElement>();
        const doc = this.view.state.doc;
        const visibleRanges = this.view.visibleRanges ?? [{ from: 0, to: doc.length }];

        let matchedLines: number[] = [];
        for (const range of visibleRanges) {
            let pos = range.from;
            while (pos <= range.to) {
                const line = doc.lineAt(pos);
                const lineNumber = line.number;
                if (this.isLineNumberInRanges(lineNumber, normalizedRanges)) {
                    matchedLines.push(lineNumber);
                    const lineEl = this.getLineElementForLine(lineNumber);
                    if (lineEl) {
                        nextLineElements.add(lineEl);
                        console.log('[Dragger Debug] Found line element for line', lineNumber, ':', lineEl.className);
                    } else {
                        console.log('[Dragger Debug] No line element found for line', lineNumber);
                    }
                    const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
                    if (lineNumberEl) {
                        nextLineNumberElements.add(lineNumberEl);
                    }
                    if (highlightHandles) {
                        const handleEl = this.getInlineHandleForLine(lineNumber);
                        if (handleEl) {
                            nextHandleElements.add(handleEl);
                        }
                    }
                }
                pos = line.to + 1;
            }
        }
        console.log('[Dragger Debug] Matched lines:', matchedLines, 'lineElements count:', nextLineElements.size);
        if (matchedLines.length > 0 && nextLineElements.size === 0) {
            this.scheduleLineResolutionRetry();
        } else {
            this.clearLineResolutionRetry();
        }
        this.syncSelectionElements(
            this.lineElements,
            nextLineElements,
            RANGE_SELECTED_LINE_CLASS
        );
        // Verify after sync
        console.log('[Dragger Debug] After sync, checking DOM for class:', RANGE_SELECTED_LINE_CLASS);
        const checkEls = this.view.dom.querySelectorAll('.' + RANGE_SELECTED_LINE_CLASS);
        console.log('[Dragger Debug] DOM elements with class:', checkEls.length);
        this.syncSelectionElements(
            this.lineNumberElements,
            nextLineNumberElements,
            RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS
        );
        this.syncSelectionElements(
            this.handleElements,
            nextHandleElements,
            RANGE_SELECTED_HANDLE_CLASS
        );
        if (showLinks) {
            this.updateLinks(normalizedRanges);
        } else {
            this.hideLinks();
        }
    }

    clear(): void {
        // Add stack trace to find who is calling clear
        console.log('[Dragger Debug] RangeSelectionVisualManager.clear called, lineElements count:', this.lineElements.size);
        console.log('[Dragger Debug] clear() stack trace:', new Error().stack);

        // Clear tracked elements
        for (const lineEl of this.lineElements) {
            lineEl.classList.remove(RANGE_SELECTED_LINE_CLASS);
        }
        this.lineElements.clear();

        for (const lineNumberEl of this.lineNumberElements) {
            lineNumberEl.classList.remove(RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS);
        }
        this.lineNumberElements.clear();

        for (const handleEl of this.handleElements) {
            handleEl.classList.remove(RANGE_SELECTED_HANDLE_CLASS);
        }
        this.handleElements.clear();

        // Also clear any remaining elements in the DOM that might have been left behind
        // (this can happen if the document changed and elements were replaced)
        const remainingLineElements = this.view.dom.querySelectorAll(`.${RANGE_SELECTED_LINE_CLASS}`);
        remainingLineElements.forEach(el => el.classList.remove(RANGE_SELECTED_LINE_CLASS));

        const remainingHandleElements = this.view.dom.querySelectorAll(`.${RANGE_SELECTED_HANDLE_CLASS}`);
        remainingHandleElements.forEach(el => el.classList.remove(RANGE_SELECTED_HANDLE_CLASS));

        console.log('[Dragger Debug] Cleared remaining elements - lines:', remainingLineElements.length, 'handles:', remainingHandleElements.length);

        this.hideLinks();
        this.clearLineResolutionRetry();
    }

    private hideLinks(): void {
        for (const link of this.linkEls) {
            link.classList.remove('is-active');
        }
    }

    scheduleRefresh(): void {
        if (this.refreshRafHandle !== null) return;
        this.refreshRafHandle = window.requestAnimationFrame(() => {
            this.refreshRafHandle = null;
            this.onRefreshRequested();
        });
    }

    cancelScheduledRefresh(): void {
        if (this.refreshRafHandle === null) return;
        window.cancelAnimationFrame(this.refreshRafHandle);
        this.refreshRafHandle = null;
    }

    getAnchorY(lineNumber: number): number | null {
        const handle = this.getInlineHandleForLine(lineNumber);
        if (handle) {
            const rect = handle.getBoundingClientRect();
            if (rect.height > 0) {
                return rect.top + rect.height / 2;
            }
        }

        const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
        if (lineNumberEl) {
            const rect = lineNumberEl.getBoundingClientRect();
            if (rect.height > 0) {
                return rect.top + rect.height / 2;
            }
        }

        const lineEl = this.getLineElementForLine(lineNumber);
        if (lineEl) {
            const rect = lineEl.getBoundingClientRect();
            if (rect.height > 0) {
                return rect.top + rect.height / 2;
            }
        }

        try {
            const line = this.view.state.doc.line(lineNumber);
            const coords = this.view.coordsAtPos(line.from);
            if (coords) {
                return (coords.top + coords.bottom) / 2;
            }
        } catch {
            // ignore anchor fallback errors
        }
        return null;
    }

    getInlineHandleForLine(lineNumber: number): HTMLElement | null {
        const blockStart = lineNumber - 1;
        if (blockStart < 0) return null;
        const selector = `.${DRAG_HANDLE_CLASS}[data-block-start="${blockStart}"]`;
        const handles = Array.from(this.view.dom.querySelectorAll<HTMLElement>(selector));
        if (handles.length === 0) return null;
        return handles.find((handle) => !handle.classList.contains(EMBED_HANDLE_CLASS)) ?? handles[0] ?? null;
    }

    getLineElementForLine(lineNumber: number): HTMLElement | null {
        if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) return null;
        if (typeof this.view.domAtPos !== 'function') return null;
        try {
            const line = this.view.state.doc.line(lineNumber);
            const fromMatch = this.resolveConnectedLineFromPos(line.from);
            if (fromMatch) return fromMatch;
            const toMatch = this.resolveConnectedLineFromPos(line.to);
            if (toMatch) return toMatch;
            const coords = this.view.coordsAtPos(line.from);
            if (!coords || typeof document.elementFromPoint !== 'function') return null;
            const x = Math.round((coords.left + coords.right) / 2);
            const y = Math.round((coords.top + coords.bottom) / 2);
            const hit = document.elementFromPoint(x, y);
            if (!(hit instanceof Element)) return null;
            const lineEl = hit.closest<HTMLElement>('.cm-line');
            if (!lineEl || !lineEl.isConnected) return null;
            if (!this.view.contentDOM.contains(lineEl)) return null;
            return lineEl;
        } catch {
            return null;
        }
    }

    destroy(): void {
        this.clear();
        for (const link of this.linkEls) {
            link.remove();
        }
        this.linkEls.length = 0;
        this.cancelScheduledRefresh();
        this.clearLineResolutionRetry();
        this.unbindScrollListener();
    }

    private bindScrollListener(): void {
        this.unbindScrollListener();
        const scroller = this.view.scrollDOM
            ?? this.view.dom.querySelector<HTMLElement>('.cm-scroller')
            ?? null;
        if (!scroller) return;
        scroller.addEventListener('scroll', this.onScroll, { passive: true });
        this.scrollContainer = scroller;
    }

    private unbindScrollListener(): void {
        if (!this.scrollContainer) return;
        this.scrollContainer.removeEventListener('scroll', this.onScroll);
        this.scrollContainer = null;
    }

    private syncSelectionElements(
        current: Set<HTMLElement>,
        next: Set<HTMLElement>,
        className: string
    ): void {
        console.log('[Dragger Debug] syncSelectionElements', {
            className,
            currentSize: current.size,
            nextSize: next.size,
        });

        // Remove class from elements that are no longer selected
        // Use a direct DOM check instead of relying on Set identity
        for (const el of current) {
            if (!next.has(el) && el.isConnected) {
                el.classList.remove(className);
            }
        }

        // Add class to all elements in next set (they should all have the class)
        let addedCount = 0;
        for (const el of next) {
            if (!el.isConnected) continue;
            if (!el.classList.contains(className)) {
                el.classList.add(className);
                addedCount++;
            }
        }
        console.log('[Dragger Debug] syncSelectionElements added', addedCount, 'classes');

        current.clear();
        for (const el of next) {
            if (!el.isConnected) continue;
            current.add(el);
        }
    }

    private resolveConnectedLineFromPos(pos: number): HTMLElement | null {
        const domAtPos = this.view.domAtPos(pos);
        const base = domAtPos.node.nodeType === Node.TEXT_NODE
            ? domAtPos.node.parentElement
            : domAtPos.node;
        if (!(base instanceof Element)) return null;
        const lineEl = base.closest<HTMLElement>('.cm-line');
        if (!lineEl || !lineEl.isConnected) return null;
        if (!this.view.contentDOM.contains(lineEl)) return null;
        return lineEl;
    }

    private scheduleLineResolutionRetry(): void {
        if (this.lineResolutionRetryCount >= MAX_LINE_RESOLUTION_RETRIES) return;
        if (this.lineResolutionRetryHandle !== null) return;
        this.lineResolutionRetryCount += 1;
        this.lineResolutionRetryHandle = window.setTimeout(() => {
            this.lineResolutionRetryHandle = null;
            this.scheduleRefresh();
        }, LINE_RESOLUTION_RETRY_DELAY_MS);
    }

    private clearLineResolutionRetry(): void {
        this.lineResolutionRetryCount = 0;
        if (this.lineResolutionRetryHandle === null) return;
        window.clearTimeout(this.lineResolutionRetryHandle);
        this.lineResolutionRetryHandle = null;
    }

    private isLineNumberInRanges(lineNumber: number, ranges: LineRange[]): boolean {
        for (const range of ranges) {
            if (lineNumber >= range.startLineNumber && lineNumber <= range.endLineNumber) {
                return true;
            }
        }
        return false;
    }

    private mergeLineRanges(ranges: LineRange[]): LineRange[] {
        if (ranges.length <= 1) return ranges;
        const sorted = [...ranges].sort((a, b) => a.startLineNumber - b.startLineNumber);
        const merged: LineRange[] = [sorted[0]];
        for (let i = 1; i < sorted.length; i++) {
            const last = merged[merged.length - 1];
            const current = sorted[i];
            if (current.startLineNumber <= last.endLineNumber + 1) {
                last.endLineNumber = Math.max(last.endLineNumber, current.endLineNumber);
            } else {
                merged.push({ ...current });
            }
        }
        return merged;
    }

    private updateLinks(ranges: LineRange[]): void {
        const editorRect = this.view.dom.getBoundingClientRect();
        const centerX = getHandleColumnCenterX(this.view);
        const left = viewportXToEditorLocalX(this.view, centerX);
        const localViewportHeight = Math.max(0, this.view.dom.clientHeight || editorRect.height);

        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            const startAnchorY = this.getAnchorY(range.startLineNumber);
            const endAnchorY = this.getAnchorY(range.endLineNumber);
            const link = this.ensureLinkEl(i);
            if (startAnchorY === null || endAnchorY === null) {
                link.classList.remove('is-active');
                continue;
            }
            const topY = Math.min(startAnchorY, endAnchorY);
            const bottomY = Math.max(startAnchorY, endAnchorY);
            const top = viewportYToEditorLocalY(this.view, topY);
            const bottom = viewportYToEditorLocalY(this.view, bottomY);
            const clampedTop = Math.max(0, Math.min(localViewportHeight, top));
            const clampedBottom = Math.max(clampedTop + 2, Math.min(localViewportHeight, bottom));
            link.classList.add('is-active');
            link.setCssStyles({
                left: `${left.toFixed(2)}px`,
                top: `${clampedTop.toFixed(2)}px`,
                height: `${Math.max(2, clampedBottom - clampedTop).toFixed(2)}px`,
            });
        }
        for (let i = ranges.length; i < this.linkEls.length; i++) {
            this.linkEls[i].classList.remove('is-active');
        }
    }

    private ensureLinkEl(index: number): HTMLElement {
        const existing = this.linkEls[index];
        if (existing && existing.isConnected) {
            return existing;
        }
        const link = document.createElement('div');
        link.className = RANGE_SELECTION_LINK_CLASS;
        this.view.dom.appendChild(link);
        this.linkEls[index] = link;
        return link;
    }
}
