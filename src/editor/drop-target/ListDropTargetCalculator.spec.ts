import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { BlockType } from '../../types';
import { parseLineWithQuote } from '../core/line-parsing';
import { ListDropTargetCalculator } from './ListDropTargetCalculator';

function createViewStub(docText: string): EditorView {
    const state = EditorState.create({ doc: docText });
    const viewStub = {
        state,
        defaultCharacterWidth: 7,
        coordsAtPos: (pos: number) => ({
            left: pos * 2,
            right: pos * 2 + 20,
            top: 0,
            bottom: 20,
        }),
    };
    return viewStub as unknown as EditorView;
}

describe('ListDropTargetCalculator', () => {
    it('calls getIndentUnitWidthForDoc once per target computation', () => {
        const view = createViewStub('- root\n- sibling');
        const getIndentUnitWidthForDoc = vi.fn(() => 2);
        const calculator = new ListDropTargetCalculator(view, {
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getPreviousNonEmptyLineNumber: (_doc, lineNumber) => (lineNumber >= 1 ? lineNumber : null),
            getIndentUnitWidthForDoc,
            getBlockRect: () => ({ top: 0, left: 0, width: 100, height: 20 }),
        });

        const result = calculator.computeListTarget({
            targetLineNumber: 2,
            lineNumber: 1,
            forcedLineNumber: null,
            childIntentOnLine: false,
            dragSource: {
                type: BlockType.ListItem,
                startLine: 0,
                endLine: 0,
                from: 0,
                to: 6,
                indentLevel: 0,
                content: '- root',
            },
            clientX: 20,
        });

        expect(result.listContextLineNumber).toBeTypeOf('number');
        expect(getIndentUnitWidthForDoc).toHaveBeenCalledTimes(1);
    });

    it('reuses cached list target when input stays in the same x bucket', () => {
        const view = createViewStub('- root\n- sibling');
        const getPreviousNonEmptyLineNumber = vi.fn((_doc, lineNumber) => (lineNumber >= 1 ? lineNumber : null));
        const calculator = new ListDropTargetCalculator(view, {
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getPreviousNonEmptyLineNumber,
            getIndentUnitWidthForDoc: () => 2,
            getBlockRect: () => ({ top: 0, left: 0, width: 100, height: 20 }),
        });
        const dragSource = {
            type: BlockType.ListItem,
            startLine: 0,
            endLine: 0,
            from: 0,
            to: 6,
            indentLevel: 0,
            content: '- root',
        };

        calculator.computeListTarget({
            targetLineNumber: 2,
            lineNumber: 1,
            forcedLineNumber: null,
            childIntentOnLine: false,
            dragSource,
            clientX: 20,
        });
        calculator.computeListTarget({
            targetLineNumber: 2,
            lineNumber: 1,
            forcedLineNumber: null,
            childIntentOnLine: false,
            dragSource,
            clientX: 21,
        });

        expect(getPreviousNonEmptyLineNumber).toHaveBeenCalledTimes(1);
    });

    it('uses lightweight highlight fallback for large subtrees without block rect scan', () => {
        const lines = ['- root'];
        for (let i = 0; i < 250; i++) {
            lines.push(`  continuation ${i}`);
        }
        lines.push('- sibling');
        const view = createViewStub(lines.join('\n'));
        const getBlockRect = vi.fn(() => ({ top: 0, left: 0, width: 100, height: 20 }));
        const calculator = new ListDropTargetCalculator(view, {
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getPreviousNonEmptyLineNumber: (_doc, lineNumber) => (lineNumber >= 1 ? lineNumber : null),
            getIndentUnitWidthForDoc: () => 2,
            getBlockRect,
        });

        const result = calculator.computeListTarget({
            targetLineNumber: lines.length,
            lineNumber: lines.length - 1,
            forcedLineNumber: null,
            childIntentOnLine: false,
            dragSource: {
                type: BlockType.ListItem,
                startLine: 0,
                endLine: 250,
                from: 0,
                to: 8,
                indentLevel: 0,
                content: '- root',
            },
            clientX: 25,
        });

        expect(result.listContextLineNumber).toBeTypeOf('number');
        expect(getBlockRect).not.toHaveBeenCalled();
    });
});
