// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../types';
import { parseLineWithQuote } from '../core/line-parsing';
import { DropTargetCalculator, type DropTargetCalculatorDeps } from './DropTargetCalculator';

const originalElementFromPoint = document.elementFromPoint;

function createViewStub(docText: string): EditorView {
    const state = EditorState.create({ doc: docText });
    const root = document.createElement('div');
    root.className = 'cm-editor';
    root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    document.body.appendChild(root);

    const viewStub = {
        state,
        dom: root,
        contentDOM: root,
        defaultCharacterWidth: 7,
        posAtCoords: () => 0,
        coordsAtPos: () => ({ left: 10, right: 110, top: 0, bottom: 20 }),
    };

    return viewStub as unknown as EditorView;
}

function mockElementFromPoint(el: Element | null): void {
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        writable: true,
        value: vi.fn(() => el),
    });
}

function createDeps(overrides?: Partial<DropTargetCalculatorDeps>): DropTargetCalculatorDeps {
    return {
        parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
        getAdjustedTargetLocation: (lineNumber) => ({ lineNumber, blockAdjusted: false }),
        clampTargetLineNumber: (_total, lineNumber) => lineNumber,
        getPreviousNonEmptyLineNumber: (_doc, lineNumber) => (lineNumber >= 1 ? lineNumber : null),
        shouldPreventDropIntoDifferentContainer: () => false,
        getBlockInfoForEmbed: () => null,
        getIndentUnitWidthForDoc: () => 2,
        getLineRect: () => ({ left: 10, width: 100 }),
        getInsertionAnchorY: () => 12,
        getLineIndentPosByWidth: () => null,
        getBlockRect: () => ({ top: 0, left: 0, width: 100, height: 20 }),
        clampNumber: (value, min, max) => Math.max(min, Math.min(max, value)),
        ...overrides,
    };
}

function createSourceBlock(content = 'source'): BlockInfo {
    return {
        type: BlockType.Paragraph,
        startLine: 0,
        endLine: 0,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        writable: true,
        value: originalElementFromPoint,
    });
});

describe('DropTargetCalculator', () => {
    it('computes a basic drop target from pointer position', () => {
        mockElementFromPoint(null);
        const view = createViewStub('plain line');
        const calculator = new DropTargetCalculator(view, createDeps());

        const target = calculator.getDropTargetInfo({ clientX: 40, clientY: 5 });

        expect(target).not.toBeNull();
        expect(target?.lineNumber).toBe(1);
        expect(target?.indicatorY).toBe(12);
    });

    it('returns null when container policy blocks the drop', () => {
        mockElementFromPoint(null);
        const view = createViewStub('plain line');
        const calculator = new DropTargetCalculator(view, createDeps({
            shouldPreventDropIntoDifferentContainer: () => true,
        }));

        const target = calculator.getDropTargetInfo({
            clientX: 40,
            clientY: 5,
            dragSource: createSourceBlock(),
        });

        expect(target).toBeNull();
    });
});
