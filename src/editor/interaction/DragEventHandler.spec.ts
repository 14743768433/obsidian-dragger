// @vitest-environment jsdom

import { EditorSelection, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../types';
import { DragEventHandler } from './DragEventHandler';

type RectLike = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    x: number;
    y: number;
    toJSON: () => Record<string, never>;
};

const originalMatchMedia = window.matchMedia;
const originalVibrate = (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }).vibrate;
let originalElementFromPoint: ((this: void, x: number, y: number) => Element | null) | undefined;

function createRect(left: number, top: number, width: number, height: number): RectLike {
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
    };
}

function createBlock(content = '- item', startLine = 0, endLine = startLine): BlockInfo {
    const start = Math.max(0, startLine);
    const end = Math.max(start, endLine);
    return {
        type: BlockType.ListItem,
        startLine: start,
        endLine: end,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

function createViewStub(lineCountOrLines: number | string[] = 1): EditorView {
    const root = document.createElement('div');
    const content = document.createElement('div');
    root.appendChild(content);
    document.body.appendChild(root);

    const lineTexts = Array.isArray(lineCountOrLines)
        ? lineCountOrLines
        : Array.from({ length: lineCountOrLines }, (_, i) => `line ${i + 1}`);
    const state = EditorState.create({
        doc: lineTexts.join('\n'),
    });
    const lineElements: HTMLElement[] = [];
    for (const text of lineTexts) {
        const lineEl = document.createElement('div');
        lineEl.className = 'cm-line';
        lineEl.textContent = text;
        content.appendChild(lineEl);
        lineElements.push(lineEl);
    }
    const docLength = state.doc.length;

    Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(0, 0, 400, 200),
    });
    Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(0, 0, 360, 200),
    });

    return {
        dom: root,
        contentDOM: content,
        state,
        visibleRanges: [{ from: 0, to: docLength }],
        coordsAtPos: (pos: number) => {
            const line = state.doc.lineAt(pos);
            const top = (line.number - 1) * 20;
            return { left: 40, right: 120, top, bottom: top + 20 };
        },
        posAtCoords: (coords: { x: number; y: number }) => {
            if (!Number.isFinite(coords.y)) return null;
            const lineNumber = Math.max(1, Math.min(state.doc.lines, Math.floor(coords.y / 20) + 1));
            return state.doc.line(lineNumber).from;
        },
        domAtPos: (pos: number) => {
            const line = state.doc.lineAt(pos);
            const node = lineElements[Math.max(0, line.number - 1)] ?? content;
            return { node, offset: 0 };
        },
        posAtDOM: (node: Node) => {
            const lineIndex = Math.max(0, lineElements.findIndex((lineEl) => lineEl === node || lineEl.contains(node)));
            return state.doc.line(Math.min(state.doc.lines, lineIndex + 1)).from;
        },
    } as unknown as EditorView;
}

function dispatchPointer(
    target: EventTarget,
    type: string,
    init: { pointerId: number; pointerType: string; clientX: number; clientY: number; button?: number; buttons?: number }
): PointerEvent {
    const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
    const inferredButtons = init.buttons ?? (
        init.pointerType === 'mouse'
            ? (type === 'pointerup' || type === 'pointercancel' ? 0 : 1)
            : 0
    );
    Object.defineProperty(event, 'pointerId', { value: init.pointerId });
    Object.defineProperty(event, 'pointerType', { value: init.pointerType });
    Object.defineProperty(event, 'clientX', { value: init.clientX });
    Object.defineProperty(event, 'clientY', { value: init.clientY });
    Object.defineProperty(event, 'button', { value: init.button ?? 0 });
    Object.defineProperty(event, 'buttons', { value: inferredButtons });
    target.dispatchEvent(event);
    return event;
}

function dispatchDrop(
    target: EventTarget,
    init: {
        clientX: number;
        clientY: number;
        dataTransfer: { types: string[]; getData: (type: string) => string; dropEffect?: string };
    }
): DragEvent {
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'clientX', { value: init.clientX });
    Object.defineProperty(event, 'clientY', { value: init.clientY });
    Object.defineProperty(event, 'dataTransfer', { value: init.dataTransfer });
    target.dispatchEvent(event);
    return event;
}

function applyTextSelection(view: EditorView, fromLine: number, toLine: number): void {
    const doc = view.state.doc;
    const safeFromLine = Math.max(1, Math.min(doc.lines, fromLine));
    const safeToLine = Math.max(1, Math.min(doc.lines, toLine));
    const anchor = doc.line(safeFromLine).from;
    const head = doc.line(safeToLine).to;
    (view as unknown as { state: EditorState }).state = EditorState.create({
        doc: doc.toString(),
        selection: { anchor, head },
    });
}

function applyMultiTextSelections(view: EditorView, ranges: Array<{ fromLine: number; toLine: number }>): void {
    const doc = view.state.doc;
    const selectionRanges = ranges.map((range) => {
        const safeFromLine = Math.max(1, Math.min(doc.lines, range.fromLine));
        const safeToLine = Math.max(1, Math.min(doc.lines, range.toLine));
        const anchor = doc.line(safeFromLine).from;
        const head = doc.line(safeToLine).to;
        return EditorSelection.range(anchor, head);
    });
    (view as unknown as { state: EditorState }).state = EditorState.create({
        doc: doc.toString(),
        extensions: [EditorState.allowMultipleSelections.of(true)],
        selection: EditorSelection.create(selectionRanges),
    });
}

beforeEach(() => {
    if (!originalElementFromPoint && typeof document.elementFromPoint === 'function') {
        const native = document.elementFromPoint.bind(document);
        originalElementFromPoint = (x: number, y: number) => native(x, y);
    }
    vi.useFakeTimers();
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: query === '(hover: none) and (pointer: coarse)',
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
    });
    Object.defineProperty(window.navigator, 'vibrate', {
        configurable: true,
        writable: true,
        value: originalVibrate,
    });
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        writable: true,
        value: originalElementFromPoint,
    });
});

describe('DragEventHandler', () => {
    it('commits range selection from mobile hotzone long-press without immediate drag', () => {
        const view = createViewStub();
        const sourceBlock = createBlock();
        const beginPointerDragSession = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => null,
            getBlockInfoAtPoint: () => sourceBlock,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(view.dom, 'pointerdown', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 32,
            clientY: 10,
        });
        vi.advanceTimersByTime(940);
        dispatchPointer(window, 'pointermove', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 32,
            clientY: 10,
        });

        dispatchPointer(window, 'pointerup', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 32,
            clientY: 10,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        expect(link?.classList.contains('is-active')).toBe(true);
        handler.destroy();
    });

    it('does not start drag when pointerdown is outside hotzone', () => {
        const view = createViewStub();
        const beginPointerDragSession = vi.fn();
        const performDropAtPoint = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => null,
            getBlockInfoAtPoint: () => createBlock(),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });

        handler.attach();
        dispatchPointer(view.dom, 'pointerdown', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 120,
            clientY: 10,
        });
        vi.advanceTimersByTime(260);
        dispatchPointer(window, 'pointermove', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 140,
            clientY: 10,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 140,
            clientY: 10,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(performDropAtPoint).not.toHaveBeenCalled();
        handler.destroy();
    });

    it('supports mouse two-stage flow: first select range, then long-press selected bar to drag', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const finishDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const hideDropIndicator = vi.fn();
        const performDropAtPoint = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession,
            scheduleDropIndicatorUpdate,
            hideDropIndicator,
            performDropAtPoint,
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 7,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);

        dispatchPointer(window, 'pointermove', {
            pointerId: 7,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 7,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 7,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        dispatchPointer(link!, 'pointerdown', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 80,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 105,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const selectedBlock = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(selectedBlock.startLine).toBe(1);
        expect(selectedBlock.endLine).toBe(5);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 105, expect.objectContaining({
            startLine: 1,
            endLine: 5,
        }), 'mouse');
        dispatchPointer(window, 'pointerup', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 105,
        });

        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        expect(handle.getAttribute('draggable')).toBe('true');
        handler.destroy();
    });

    it('starts dragging committed mouse selection immediately on move without second long-press', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 70,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 70,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 70,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();

        dispatchPointer(link!, 'pointerdown', {
            pointerId: 71,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 80,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 71,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 80,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 80, expect.any(Object), 'mouse');
        handler.destroy();
    });

    it('falls back to point-based source resolution when handle mapping is stale', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => null,
            getBlockInfoAtPoint: () => sourceBlock,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 75,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 75,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 90,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 75,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 90,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        expect(link?.classList.contains('is-active')).toBe(true);
        handler.destroy();
    });

    it('selects a single block on handle click and drags it on the next handle gesture', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        handle.setAttribute('data-block-start', '1');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(() => null),
        });

        handler.attach();

        dispatchPointer(handle, 'pointerdown', {
            pointerId: 201,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 201,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });

        let lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[0]?.classList.contains('dnd-range-selected-line')).toBe(false);

        dispatchPointer(handle, 'pointerdown', {
            pointerId: 202,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 202,
            pointerType: 'mouse',
            clientX: 36,
            clientY: 30,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const dragged = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(dragged.startLine).toBe(1);
        expect(dragged.endLine).toBe(1);
        handler.destroy();
    });

    it('supports touch thresholds: shorter long-press drags single block, longer long-press enters range selection', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const finishDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const hideDropIndicator = vi.fn();
        const performDropAtPoint = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession,
            scheduleDropIndicatorUpdate,
            hideDropIndicator,
            performDropAtPoint,
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 17,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(260);

        dispatchPointer(window, 'pointermove', {
            pointerId: 17,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 17,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        beginPointerDragSession.mockClear();
        performDropAtPoint.mockClear();
        finishDragSession.mockClear();
        scheduleDropIndicatorUpdate.mockClear();

        dispatchPointer(handle, 'pointerdown', {
            pointerId: 18,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(940);
        dispatchPointer(window, 'pointermove', {
            pointerId: 18,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 18,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        dispatchPointer(link!, 'pointerdown', {
            pointerId: 19,
            pointerType: 'touch',
            clientX: 12,
            clientY: 80,
        });
        vi.advanceTimersByTime(120);
        dispatchPointer(window, 'pointermove', {
            pointerId: 19,
            pointerType: 'touch',
            clientX: 90,
            clientY: 105,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const selectedBlock = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(selectedBlock.startLine).toBe(1);
        expect(selectedBlock.endLine).toBe(5);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 105, expect.objectContaining({
            startLine: 1,
            endLine: 5,
        }), 'touch');

        dispatchPointer(window, 'pointerup', {
            pointerId: 19,
            pointerType: 'touch',
            clientX: 90,
            clientY: 105,
        });

        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        expect(handle.getAttribute('draggable')).toBe('true');
        handler.destroy();
    });

    it('clears committed selection when clicking content area on the right side', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 41,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 41,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 41,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-line').length).toBeGreaterThan(0);
        expect(view.dom.querySelector('.dnd-range-selection-link')).toBeNull();

        const lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        dispatchPointer(lines[7] ?? view.contentDOM, 'pointerdown', {
            pointerId: 42,
            pointerType: 'mouse',
            clientX: 220,
            clientY: 170,
        });

        expect(view.dom.querySelector('.dnd-range-selection-link')).toBeNull();
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        handler.destroy();
    });

    it('keeps committed selection on touch content tap and clears it when editor input gains focus', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 61,
            pointerType: 'touch',
            clientX: 32,
            clientY: 30,
        });
        vi.advanceTimersByTime(940);
        dispatchPointer(window, 'pointermove', {
            pointerId: 61,
            pointerType: 'touch',
            clientX: 32,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 61,
            pointerType: 'touch',
            clientX: 32,
            clientY: 105,
        });

        let link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link?.classList.contains('is-active')).toBe(true);

        dispatchPointer(view.contentDOM, 'pointerdown', {
            pointerId: 62,
            pointerType: 'touch',
            clientX: 220,
            clientY: 40,
        });

        link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link?.classList.contains('is-active')).toBe(true);

        const input = document.createElement('textarea');
        view.dom.appendChild(input);
        input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));

        link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link?.classList.contains('is-active')).toBe(false);
        handler.destroy();
    });

    it('repositions committed selection links after scroll', () => {
        const view = createViewStub(8);
        (view as unknown as { scrollDOM?: HTMLElement }).scrollDOM = view.dom;
        let scrollOffset = 0;
        (view as unknown as { coordsAtPos: (pos: number) => { left: number; right: number; top: number; bottom: number } | null }).coordsAtPos = (pos: number) => {
            const line = view.state.doc.lineAt(pos);
            const top = (line.number - 1) * 20 - scrollOffset;
            return { left: 40, right: 120, top, bottom: top + 20 };
        };

        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 43,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 43,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 43,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        const topBefore = Number(link?.style.top.replace('px', '') || '0');

        scrollOffset = 40;
        view.dom.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(20);

        const topAfter = Number(link?.style.top.replace('px', '') || '0');
        expect(topAfter).toBeLessThan(topBefore);
        handler.destroy();
    });

    it('expands selection to whole list block when range touches any list line', () => {
        const view = createViewStub([
            'intro',
            '- parent',
            '  - child',
            'after',
            'tail',
        ]);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock: BlockInfo = {
            type: BlockType.Paragraph,
            startLine: 0,
            endLine: 0,
            from: 0,
            to: 5,
            indentLevel: 0,
            content: 'intro',
        };
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 9,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 10,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 9,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 25, // line 2: list parent
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 9,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 25,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 9,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 25,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        dispatchPointer(link!, 'pointerdown', {
            pointerId: 10,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 25,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 10,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 25,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const selectedBlock = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(selectedBlock.startLine).toBe(0);
        expect(selectedBlock.endLine).toBe(2); // list child line must be included
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 25, expect.objectContaining({
            startLine: 0,
            endLine: 2,
        }), 'mouse');
        handler.destroy();
    });

    it('captures rendered embed block during downward range selection without requiring blank line hit', () => {
        const view = createViewStub([
            'intro',
            'anchor',
            'before',
            'around',
            '> [!note] title',
            '> body',
            'tail',
        ]);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('anchor', 1, 1);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();

        const embed = document.createElement('div');
        embed.className = 'cm-callout';
        view.dom.appendChild(embed);

        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: vi.fn((clientX: number, clientY: number) => {
                if (clientY >= 82 && clientY <= 138 && clientX >= 6 && clientX <= 240) {
                    return embed;
                }
                return null;
            }),
        });

        const originalPosAtCoords = view.posAtCoords.bind(view);
        (view as unknown as { posAtCoords: (coords: { x: number; y: number }) => number | null }).posAtCoords = (coords) => {
            if (coords.y >= 82 && coords.y <= 138) {
                // Simulate rendered block hit mismatch: point looks inside callout but resolves to previous line.
                return view.state.doc.line(4).from;
            }
            return originalPosAtCoords(coords);
        };

        const originalPosAtDOM = view.posAtDOM.bind(view);
        (view as unknown as { posAtDOM: (node: Node, offset?: number) => number }).posAtDOM = (node: Node, offset?: number) => {
            if (node === embed || embed.contains(node)) {
                return view.state.doc.line(5).from;
            }
            return originalPosAtDOM(node, offset);
        };

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 11,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 11,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 92,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 11,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 92,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 11,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 92,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        dispatchPointer(link!, 'pointerdown', {
            pointerId: 12,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 92,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 12,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 92,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const selectedBlock = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(selectedBlock.startLine).toBe(1);
        expect(selectedBlock.endLine).toBe(5);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 92, expect.objectContaining({
            startLine: 1,
            endLine: 5,
        }), 'mouse');
        handler.destroy();
    });

    it('keeps disjoint committed ranges and drags them as one ordered composite source', () => {
        const view = createViewStub(12);
        const handleA = document.createElement('div');
        handleA.className = 'dnd-drag-handle';
        handleA.setAttribute('draggable', 'true');
        const handleB = document.createElement('div');
        handleB.className = 'dnd-drag-handle';
        handleB.setAttribute('draggable', 'true');
        view.dom.appendChild(handleA);
        view.dom.appendChild(handleB);

        const blockA = createBlock('line 2', 1, 1);
        const blockB = createBlock('line 8', 7, 7);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const performDropAtPoint = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: (handle) => {
                if (handle === handleA) return blockA;
                if (handle === handleB) return blockB;
                return null;
            },
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });

        handler.attach();

        dispatchPointer(handleA, 'pointerdown', {
            pointerId: 30,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 30,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 30,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });

        dispatchPointer(handleB, 'pointerdown', {
            pointerId: 31,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 150,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 31,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 150,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 31,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 150,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();

        dispatchPointer(link!, 'pointerdown', {
            pointerId: 32,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 80,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 32,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 80,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const composite = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(composite.startLine).toBe(1);
        expect(composite.endLine).toBe(7);
        expect(composite.compositeSelection?.ranges).toEqual([
            { startLine: 1, endLine: 1 },
            { startLine: 7, endLine: 7 },
        ]);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 80, expect.objectContaining({
            compositeSelection: {
                ranges: [
                    { startLine: 1, endLine: 1 },
                    { startLine: 7, endLine: 7 },
                ],
            },
        }), 'mouse');

        dispatchPointer(window, 'pointerup', {
            pointerId: 32,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 80,
        });

        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        const droppedSource = performDropAtPoint.mock.calls[0][0] as BlockInfo;
        expect(droppedSource.compositeSelection?.ranges).toEqual([
            { startLine: 1, endLine: 1 },
            { startLine: 7, endLine: 7 },
        ]);
        handler.destroy();
    });

    it('keeps mouse quick-drag path untouched before long-press selection activates', () => {
        const view = createViewStub(6);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);
        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const performDropAtPoint = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });

        handler.attach();
        const downEvent = dispatchPointer(handle, 'pointerdown', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        expect(downEvent.defaultPrevented).toBe(false);
        expect(handle.getAttribute('draggable')).toBe('true');

        dispatchPointer(window, 'pointermove', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 120,
            clientY: 30,
        });
        vi.advanceTimersByTime(400);
        dispatchPointer(window, 'pointerup', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 120,
            clientY: 30,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(scheduleDropIndicatorUpdate).not.toHaveBeenCalled();
        expect(performDropAtPoint).not.toHaveBeenCalled();
        expect(view.dom.querySelector('.dnd-range-selection-link')).toBeNull();
        expect(handle.getAttribute('draggable')).toBe('true');
        handler.destroy();
    });

    it('triggers vibration when dragging from committed touch selection on second long-press', () => {
        const view = createViewStub();
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        view.dom.appendChild(handle);

        const sourceBlock = createBlock();
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const vibrate = vi.fn();
        Object.defineProperty(window.navigator, 'vibrate', {
            configurable: true,
            writable: true,
            value: vibrate,
        });

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 32,
            clientY: 12,
        });
        vi.advanceTimersByTime(940);
        dispatchPointer(window, 'pointermove', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 32,
            clientY: 12,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 32,
            clientY: 12,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        dispatchPointer(link!, 'pointerdown', {
            pointerId: 3,
            pointerType: 'touch',
            clientX: 32,
            clientY: 12,
        });
        vi.advanceTimersByTime(120);
        dispatchPointer(window, 'pointermove', {
            pointerId: 3,
            pointerType: 'touch',
            clientX: 45,
            clientY: 12,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(45, 12, expect.objectContaining({
            startLine: 0,
            endLine: 0,
        }), 'touch');
        expect(vibrate).toHaveBeenCalledTimes(1);
        handler.destroy();
    });

    it('allows touch drag from committed selection when pressing hotzone over selected range', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 51,
            pointerType: 'touch',
            clientX: 32,
            clientY: 30,
        });
        vi.advanceTimersByTime(940);
        dispatchPointer(window, 'pointermove', {
            pointerId: 51,
            pointerType: 'touch',
            clientX: 32,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 51,
            pointerType: 'touch',
            clientX: 32,
            clientY: 105,
        });

        dispatchPointer(view.contentDOM, 'pointerdown', {
            pointerId: 52,
            pointerType: 'touch',
            clientX: 32,
            clientY: 80,
        });
        vi.advanceTimersByTime(120);
        dispatchPointer(window, 'pointermove', {
            pointerId: 52,
            pointerType: 'touch',
            clientX: 90,
            clientY: 80,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 80, expect.any(Object), 'touch');
        handler.destroy();
    });

    it('skips range-selection flow on mouse when multi-line selection is disabled', () => {
        const view = createViewStub(6);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 81,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(600);
        dispatchPointer(window, 'pointermove', {
            pointerId: 81,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 90,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 81,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 90,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(view.dom.querySelector('.dnd-range-selection-link')).toBeNull();
        handler.destroy();
    });

    it('falls back to single-block touch drag when multi-line selection is disabled', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const performDropAtPoint = vi.fn(() => 4);
        const finishDragSession = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => false,
            beginPointerDragSession,
            finishDragSession,
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 82,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(260);
        dispatchPointer(window, 'pointermove', {
            pointerId: 82,
            pointerType: 'touch',
            clientX: 90,
            clientY: 80,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 82,
            pointerType: 'touch',
            clientX: 90,
            clientY: 80,
        });
        vi.advanceTimersByTime(1);

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 80, expect.objectContaining({
            startLine: 1,
            endLine: 1,
        }), 'touch');
        const lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(false);
        expect(view.dom.querySelector('.dnd-range-selection-link')).toBeNull();
        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        handler.destroy();
    });

    it('keeps single-block selection after mouse drop event commits the move', () => {
        const view = createViewStub(8);
        const sourceBlock = createBlock('- item', 1, 1);
        const performDropAtPoint = vi.fn(() => 5);
        const finishDragSession = vi.fn();
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: (e) => {
                const raw = e.dataTransfer?.getData('application/dnd-block') ?? '';
                if (!raw) return null;
                return JSON.parse(raw) as BlockInfo;
            },
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession,
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });

        handler.attach();
        dispatchDrop(view.dom, {
            clientX: 120,
            clientY: 90,
            dataTransfer: {
                types: ['application/dnd-block'],
                getData: (type: string) => {
                    if (type === 'application/dnd-block') {
                        return JSON.stringify(sourceBlock);
                    }
                    return '';
                },
                dropEffect: 'move',
            },
        });
        vi.advanceTimersByTime(1);

        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        const lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(false);
        handler.destroy();
    });

    it('maps cross-block text selection to smart drag source and keeps moved blocks selected', () => {
        const view = createViewStub(10);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);
        applyTextSelection(view, 2, 4);

        const baseBlock = createBlock('- item', 1, 1);
        const performDropAtPoint = vi.fn(() => 6);
        const finishDragSession = vi.fn();
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: (e) => {
                const raw = e.dataTransfer?.getData('application/dnd-block') ?? '';
                if (!raw) return null;
                return JSON.parse(raw) as BlockInfo;
            },
            getBlockInfoForHandle: () => baseBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession,
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });

        handler.attach();
        const downEvent = dispatchPointer(handle, 'pointerdown', {
            pointerId: 93,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        expect(downEvent.defaultPrevented).toBe(false);

        const smartSource = handler.resolveNativeDragSourceForHandleDrag(baseBlock);
        expect(smartSource?.startLine).toBe(1);
        expect(smartSource?.endLine).toBe(3);
        handler.finalizeNativeHandleDragStart();

        dispatchDrop(view.dom, {
            clientX: 120,
            clientY: 100,
            dataTransfer: {
                types: ['application/dnd-block'],
                getData: (type: string) => {
                    if (type === 'application/dnd-block') {
                        return JSON.stringify(smartSource);
                    }
                    return '';
                },
                dropEffect: 'move',
            },
        });
        vi.advanceTimersByTime(1);

        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        const lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[4]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(false);
        handler.destroy();
    });

    it('supports both click-to-select and direct-drag for multi-block text selections', () => {
        const view = createViewStub(10);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);
        const baseBlock = createBlock('- item', 1, 1);
        const performDropAtPoint = vi.fn(() => 6);
        const finishDragSession = vi.fn();
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: (e) => {
                const raw = e.dataTransfer?.getData('application/dnd-block') ?? '';
                if (!raw) return null;
                return JSON.parse(raw) as BlockInfo;
            },
            getBlockInfoForHandle: () => baseBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession,
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });
        handler.attach();

        // Flow 1: click handle after text selection -> commit multi-block selection
        applyTextSelection(view, 2, 4);
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 501,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 501,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        let lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(true);

        // Clear committed selection using a new pointer event.
        dispatchPointer(lines[2]!, 'pointerdown', {
            pointerId: 502,
            pointerType: 'mouse',
            clientX: 220,
            clientY: 50,
        });

        // Flow 2: reselect text and directly drag handle -> keep direct multi-block move
        applyTextSelection(view, 2, 4);
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 503,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        const smartSource = handler.resolveNativeDragSourceForHandleDrag(baseBlock);
        expect(smartSource?.startLine).toBe(1);
        expect(smartSource?.endLine).toBe(3);
        handler.finalizeNativeHandleDragStart();

        dispatchDrop(view.dom, {
            clientX: 120,
            clientY: 100,
            dataTransfer: {
                types: ['application/dnd-block'],
                getData: (type: string) => {
                    if (type === 'application/dnd-block') {
                        return JSON.stringify(smartSource);
                    }
                    return '';
                },
                dropEffect: 'move',
            },
        });
        vi.advanceTimersByTime(1);

        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[4]?.classList.contains('dnd-range-selected-line')).toBe(true);
        handler.destroy();
    });

    it('selects the clicked block when text selection exists but handle is outside that text range', () => {
        const view = createViewStub(10);
        const handleOutsideSelection = document.createElement('div');
        handleOutsideSelection.className = 'dnd-drag-handle';
        handleOutsideSelection.setAttribute('draggable', 'true');
        handleOutsideSelection.setAttribute('data-block-start', '5');
        view.dom.appendChild(handleOutsideSelection);
        applyTextSelection(view, 2, 4);

        const insideSelectionBlock = createBlock('- item', 1, 1);
        const outsideSelectionBlock = createBlock('- item', 5, 5);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: (handle) => {
                if (handle === handleOutsideSelection) return outsideSelectionBlock;
                return insideSelectionBlock;
            },
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handleOutsideSelection, 'pointerdown', {
            pointerId: 301,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 110,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 301,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 110,
        });

        const lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[5]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(false);
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(false);
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(false);
        handler.destroy();
    });

    it('keeps smart multi-block selection when clicking handle with cross-block text selected', () => {
        const view = createViewStub(10);
        (view as unknown as { dispatch: (tr: { selection?: unknown }) => void }).dispatch = (tr) => {
            if (tr.selection === undefined) return;
            (view as unknown as { state: EditorState }).state = EditorState.create({
                doc: view.state.doc.toString(),
                selection: tr.selection as { anchor: number; head: number },
            });
        };
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);
        applyTextSelection(view, 2, 4);

        const baseBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => baseBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 94,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(1);
        dispatchPointer(window, 'pointerup', {
            pointerId: 94,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });

        const lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[0]?.classList.contains('dnd-range-selected-line')).toBe(false);
        handler.destroy();
    });

    it('keeps smart multi-block highlight after dispatch replaces line DOM nodes', () => {
        const view = createViewStub(10);
        const getCurrentLines = () => Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-line'));
        let staleLines: HTMLElement[] = [];
        let useStaleDomAtPos = false;

        (view as unknown as { domAtPos: (pos: number) => { node: Node; offset: number } }).domAtPos = (pos) => {
            const line = view.state.doc.lineAt(pos);
            const source = useStaleDomAtPos ? staleLines : getCurrentLines();
            const node = source[Math.max(0, line.number - 1)] ?? view.contentDOM;
            return { node, offset: 0 };
        };

        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: (_x: number, y: number) => {
                const lineIndex = Math.max(0, Math.floor(y / 20));
                return getCurrentLines()[lineIndex] ?? view.contentDOM;
            },
        });

        (view as unknown as { dispatch: (tr: { selection?: unknown }) => void }).dispatch = (tr) => {
            if (tr.selection === undefined) return;
            staleLines = getCurrentLines();
            (view as unknown as { state: EditorState }).state = EditorState.create({
                doc: view.state.doc.toString(),
                selection: tr.selection as { anchor: number; head: number },
            });
            for (const [index, oldLine] of staleLines.entries()) {
                const nextLine = document.createElement('div');
                nextLine.className = 'cm-line';
                nextLine.textContent = `line ${index + 1}`;
                oldLine.replaceWith(nextLine);
            }
            useStaleDomAtPos = true;
        };

        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        handle.setAttribute('data-block-start', '1');
        view.dom.appendChild(handle);
        applyTextSelection(view, 2, 4);

        const baseBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => baseBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 302,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(1);

        const selectedLines = view.contentDOM.querySelectorAll('.dnd-range-selected-line');
        expect(selectedLines.length).toBe(3);
        handler.destroy();
    });

    it('does not clear smart mouse selection on focusin in mobile-like environments', () => {
        const view = createViewStub(10);
        (view as unknown as { dispatch: (tr: { selection?: unknown }) => void }).dispatch = (tr) => {
            if (tr.selection === undefined) return;
            (view as unknown as { state: EditorState }).state = EditorState.create({
                doc: view.state.doc.toString(),
                selection: tr.selection as { anchor: number; head: number },
            });
        };
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);
        applyTextSelection(view, 2, 4);

        const baseBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => baseBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 96,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(1);
        dispatchPointer(window, 'pointerup', {
            pointerId: 96,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });

        const content = view.contentDOM.querySelector<HTMLElement>('.cm-line');
        expect(content).not.toBeNull();
        content?.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));

        const lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(true);
        handler.destroy();
    });

    it('guards smart selection from immediate refresh-based clear when feature flag flips transiently', () => {
        const view = createViewStub(10);
        (view as unknown as { dispatch: (tr: { selection?: unknown }) => void }).dispatch = (tr) => {
            if (tr.selection === undefined) return;
            (view as unknown as { state: EditorState }).state = EditorState.create({
                doc: view.state.doc.toString(),
                selection: tr.selection as { anchor: number; head: number },
            });
        };
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);
        applyTextSelection(view, 2, 4);

        let multiLineEnabled = true;
        const baseBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => baseBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => multiLineEnabled,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 97,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(1);
        dispatchPointer(window, 'pointerup', {
            pointerId: 97,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });

        multiLineEnabled = false;
        handler.refreshSelectionVisual();
        let lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(true);

        vi.advanceTimersByTime(600);
        handler.refreshSelectionVisual();
        lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(false);
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(false);
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(false);
        handler.destroy();
    });

    it('guards same-pointer immediate clear but allows other pointer clicks to clear committed selection', () => {
        const view = createViewStub(10);
        (view as unknown as { dispatch: (tr: { selection?: unknown }) => void }).dispatch = (tr) => {
            if (tr.selection === undefined) return;
            (view as unknown as { state: EditorState }).state = EditorState.create({
                doc: view.state.doc.toString(),
                selection: tr.selection as { anchor: number; head: number },
            });
        };
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);
        applyTextSelection(view, 2, 4);

        const baseBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => baseBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 111,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(1);
        dispatchPointer(window, 'pointerup', {
            pointerId: 111,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });

        let lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(true);

        dispatchPointer(lines[2]!, 'pointerdown', {
            pointerId: 111,
            pointerType: 'mouse',
            clientX: 220,
            clientY: 50,
        });
        lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(true);

        dispatchPointer(lines[5]!, 'pointerdown', {
            pointerId: 112,
            pointerType: 'mouse',
            clientX: 220,
            clientY: 120,
        });
        lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(false);
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(false);
        expect(lines[3]?.classList.contains('dnd-range-selected-line')).toBe(false);
        handler.destroy();
    });

    it('keeps all selected blocks when text selection has multiple disjoint ranges', () => {
        const view = createViewStub(12);
        (view as unknown as { dispatch: (tr: { selection?: unknown }) => void }).dispatch = (tr) => {
            if (tr.selection === undefined) return;
            (view as unknown as { state: EditorState }).state = EditorState.create({
                doc: view.state.doc.toString(),
                selection: tr.selection as { anchor: number; head: number },
            });
        };
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);
        applyMultiTextSelections(view, [
            { fromLine: 2, toLine: 2 },
            { fromLine: 6, toLine: 6 },
        ]);

        const baseBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => baseBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 95,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(1);
        dispatchPointer(window, 'pointerup', {
            pointerId: 95,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });

        const lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        expect(lines[1]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[5]?.classList.contains('dnd-range-selected-line')).toBe(true);
        expect(lines[2]?.classList.contains('dnd-range-selected-line')).toBe(false);
        expect(lines[4]?.classList.contains('dnd-range-selected-line')).toBe(false);
        handler.destroy();
    });
});
