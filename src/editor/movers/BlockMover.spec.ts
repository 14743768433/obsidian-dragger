import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../types';
import { BlockMover } from './BlockMover';
import { parseLineWithQuote } from '../core/line-parsing';

function createBlockFromLine(doc: EditorState['doc'], lineNumber: number): BlockInfo {
    const line = doc.line(lineNumber);
    return {
        type: BlockType.Paragraph,
        startLine: lineNumber - 1,
        endLine: lineNumber - 1,
        from: line.from,
        to: line.to,
        indentLevel: 0,
        content: line.text,
    };
}

function createListBlock(doc: EditorState['doc'], startLine: number, endLine: number): BlockInfo {
    const start = doc.line(startLine);
    const end = doc.line(endLine);
    return {
        type: BlockType.ListItem,
        startLine: startLine - 1,
        endLine: endLine - 1,
        from: start.from,
        to: end.to,
        indentLevel: 0,
        content: doc.sliceString(start.from, end.to),
    };
}

describe('BlockMover', () => {
    it('skips dispatch when container policy blocks the drop', () => {
        const state = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: false },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(state.doc, 1),
            targetPos: state.doc.line(3).from,
        });

        expect(dispatch).not.toHaveBeenCalled();
    });

    it('dispatches insert+delete changes when drop is allowed', () => {
        const state = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(state.doc, 1),
            targetPos: state.doc.line(3).from,
        });

        expect(dispatch).toHaveBeenCalledTimes(1);
        const payload = dispatch.mock.calls[0][0];
        expect(Array.isArray(payload.changes)).toBe(true);
        expect(payload.changes).toHaveLength(2);
        setTimeoutSpy.mockRestore();
    });

    it('prevents self-embedding indent when dropping list root at its own tail', () => {
        const state = EditorState.create({ doc: '- root\n  - child\nafter' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createListBlock(state.doc, 1, 2),
            targetPos: state.doc.line(3).from,
            targetLineNumberOverride: 3,
            listContextLineNumberOverride: 2,
            listTargetIndentWidthOverride: 2,
        });

        expect(dispatch).not.toHaveBeenCalled();
    });

    it('moves composite multi-range source as ordered group', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd\ne\nf' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        const line2 = state.doc.line(2);
        const line5 = state.doc.line(5);
        mover.moveBlock({
            sourceBlock: {
                type: BlockType.Paragraph,
                startLine: 1,
                endLine: 4,
                from: line2.from,
                to: line5.to,
                indentLevel: 0,
                content: 'b\ne',
                compositeSelection: {
                    ranges: [
                        { startLine: 1, endLine: 1 },
                        { startLine: 4, endLine: 4 },
                    ],
                },
            },
            targetPos: state.doc.line(1).from,
            targetLineNumberOverride: 1,
        });

        expect(dispatch).toHaveBeenCalledTimes(1);
        const payload = dispatch.mock.calls[0][0];
        expect(Array.isArray(payload.changes)).toBe(true);
        expect(payload.changes).toHaveLength(3);
        const insertChange = payload.changes.find((change: { insert?: string }) => typeof change.insert === 'string');
        expect(insertChange?.insert).toContain('b');
        expect(insertChange?.insert).toContain('e');
        setTimeoutSpy.mockRestore();
    });

    it('allows composite move into unselected gap between selected ranges', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd\ne\nf' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        const line2 = state.doc.line(2);
        const line5 = state.doc.line(5);
        mover.moveBlock({
            sourceBlock: {
                type: BlockType.Paragraph,
                startLine: 1,
                endLine: 4,
                from: line2.from,
                to: line5.to,
                indentLevel: 0,
                content: 'b\ne',
                compositeSelection: {
                    ranges: [
                        { startLine: 1, endLine: 1 },
                        { startLine: 4, endLine: 4 },
                    ],
                },
            },
            targetPos: state.doc.line(3).from,
            targetLineNumberOverride: 3,
        });

        expect(dispatch).toHaveBeenCalledTimes(1);
    });
});
