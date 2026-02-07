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

describe('BlockMover', () => {
    it('skips dispatch when container policy blocks the drop', () => {
        const state = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const mover = new BlockMover({
            view,
            clampTargetLineNumber: (_total, lineNumber) => lineNumber,
            getAdjustedTargetLocation: (lineNumber) => ({ lineNumber, blockAdjusted: false }),
            shouldPreventDropIntoDifferentContainer: () => true,
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
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
        const mover = new BlockMover({
            view,
            clampTargetLineNumber: (_total, lineNumber) => lineNumber,
            getAdjustedTargetLocation: (lineNumber) => ({ lineNumber, blockAdjusted: false }),
            shouldPreventDropIntoDifferentContainer: () => false,
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
});
