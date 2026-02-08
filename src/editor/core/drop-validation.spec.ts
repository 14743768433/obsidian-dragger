import { describe, expect, it } from 'vitest';
import { BlockType, type BlockInfo } from '../../types';
import { validateInPlaceDrop } from './drop-validation';
import { getLineMap } from './line-map';
import { parseLineWithQuote } from './line-parsing';

function createDoc(lines: string[]) {
    return {
        lines: lines.length,
        line: (n: number) => ({ text: lines[n - 1] ?? '' }),
    };
}

function createBlock(type: BlockType, startLine: number, endLine: number, content: string): BlockInfo {
    return {
        type,
        startLine,
        endLine,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

describe('drop-validation', () => {
    it('uses insertion matrix to reject invalid container drops', () => {
        const result = validateInPlaceDrop({
            doc: createDoc(['- list item']),
            sourceBlock: createBlock(BlockType.Paragraph, 0, 0, 'plain'),
            targetLineNumber: 1,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            slotContext: 'inside_list',
        });

        expect(result.allowInPlaceIndentChange).toBe(false);
        expect(result.rejectReason).toBe('inside_list');
    });

    it('keeps result stable when lineMap is provided', () => {
        const state = { doc: createDoc(['- root', '  - child', 'tail']) };
        const sourceBlock = createBlock(BlockType.ListItem, 0, 1, '- root\n  - child');
        const withoutMap = validateInPlaceDrop({
            doc: state.doc,
            sourceBlock,
            targetLineNumber: 2,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => ({ indentWidth: 0, indentRaw: '', markerType: 'unordered' }),
            getIndentUnitWidth: () => 2,
            slotContext: 'inside_list',
            listContextLineNumberOverride: 1,
            listIndentDeltaOverride: 0,
            listTargetIndentWidthOverride: 0,
        });
        const withMap = validateInPlaceDrop({
            doc: state.doc,
            sourceBlock,
            targetLineNumber: 2,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => ({ indentWidth: 0, indentRaw: '', markerType: 'unordered' }),
            getIndentUnitWidth: () => 2,
            slotContext: 'inside_list',
            lineMap: getLineMap(state),
            listContextLineNumberOverride: 1,
            listIndentDeltaOverride: 0,
            listTargetIndentWidthOverride: 0,
        });

        expect(withMap).toEqual(withoutMap);
    });
});
