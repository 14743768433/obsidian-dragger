import { describe, expect, it, vi } from 'vitest';
import { BlockType } from '../../types';
import { buildInsertText, getBlockquoteDepthContext } from './block-mutation';

function createDoc(lines: string[]) {
    return {
        lines: lines.length,
        line: (n: number) => ({ text: lines[n - 1] ?? '' }),
    };
}

describe('block-mutation', () => {
    it.each([BlockType.CodeBlock, BlockType.Table, BlockType.MathBlock])(
        'does not auto-adjust quote depth for %s',
        (type) => {
            const adjustBlockquoteDepth = vi.fn((text: string) => `> ${text}`);
            const adjustListToTargetContext = vi.fn((text: string) => text);
            const result = buildInsertText({
                doc: createDoc(['> quote context']),
                sourceBlockType: type,
                sourceContent: 'content line',
                targetLineNumber: 2,
                getBlockquoteDepthContext: () => 1,
                getContentQuoteDepth: () => 0,
                adjustBlockquoteDepth,
                adjustListToTargetContext,
            });

            expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
            expect(result).toBe('\ncontent line\n');
        }
    );

    it('does not auto-adjust quote depth for callout blocks', () => {
        const adjustBlockquoteDepth = vi.fn((text: string) => text.replace(/^> /gm, ''));
        const result = buildInsertText({
            doc: createDoc(['plain context']),
            sourceBlockType: BlockType.Callout,
            sourceContent: '> [!TIP]\n> inside',
            targetLineNumber: 2,
            getBlockquoteDepthContext: () => 0,
            getContentQuoteDepth: () => 1,
            adjustBlockquoteDepth,
            adjustListToTargetContext: (text) => text,
        });

        expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
        expect(result).toBe('> [!TIP]\n> inside\n');
    });

    it('adjusts quote depth for normal paragraph moves', () => {
        const adjustBlockquoteDepth = vi.fn((text: string, targetDepth: number) => `${'> '.repeat(targetDepth)}${text}`);
        const result = buildInsertText({
            doc: createDoc(['plain context']),
            sourceBlockType: BlockType.Paragraph,
            sourceContent: 'plain',
            targetLineNumber: 2,
            getBlockquoteDepthContext: () => 2,
            getContentQuoteDepth: () => 0,
            adjustBlockquoteDepth,
            adjustListToTargetContext: (text) => text,
        });

        expect(adjustBlockquoteDepth).toHaveBeenCalledWith('plain', 2, 0);
        expect(result).toBe('> > plain\n');
    });

    it('adds trailing blank separation for table rows', () => {
        const result = buildInsertText({
            doc: createDoc(['| a |', '| b |']),
            sourceBlockType: BlockType.Table,
            sourceContent: '| moved |',
            targetLineNumber: 2,
            getBlockquoteDepthContext: () => 0,
            getContentQuoteDepth: () => 0,
            adjustBlockquoteDepth: (text) => text,
            adjustListToTargetContext: (text) => text,
        });

        expect(result).toBe('| moved |\n\n');
    });

    it('does not inherit quote depth across a blank separator line', () => {
        const doc = createDoc(['> quote', '', 'plain']);
        const depth = getBlockquoteDepthContext(
            doc,
            2,
            (line) => (line.match(/^(\s*> ?)+/)?.[0].match(/>/g) || []).length
        );

        expect(depth).toBe(0);
    });

    it('inserts plain content after callout with a separating blank line', () => {
        const adjustBlockquoteDepth = vi.fn((text: string, targetDepth: number) => `${'> '.repeat(targetDepth)}${text}`);
        const result = buildInsertText({
            doc: createDoc(['> [!TIP]', '> inside callout']),
            sourceBlockType: BlockType.Paragraph,
            sourceContent: 'outside paragraph',
            targetLineNumber: 3,
            getBlockquoteDepthContext: () => 1,
            getContentQuoteDepth: () => 0,
            adjustBlockquoteDepth,
            adjustListToTargetContext: (text) => text,
        });

        expect(adjustBlockquoteDepth).toHaveBeenCalledWith('outside paragraph', 0, 0);
        expect(result).toBe('\noutside paragraph\n');
    });

    it('does not force quote reset when inserting between quote lines', () => {
        const adjustBlockquoteDepth = vi.fn((text: string, targetDepth: number) => `${'> '.repeat(targetDepth)}${text}`);
        const result = buildInsertText({
            doc: createDoc(['> quote A', '> quote B']),
            sourceBlockType: BlockType.Paragraph,
            sourceContent: 'middle plain',
            targetLineNumber: 2,
            getBlockquoteDepthContext: () => 1,
            getContentQuoteDepth: () => 0,
            adjustBlockquoteDepth,
            adjustListToTargetContext: (text) => text,
        });

        expect(adjustBlockquoteDepth).toHaveBeenCalledWith('middle plain', 1, 0);
        expect(result).toBe('> middle plain\n');
    });

    it('does not add an extra separator when moving blockquote content after blockquote', () => {
        const adjustBlockquoteDepth = vi.fn((text: string) => text.replace(/^> /gm, ''));
        const adjustListToTargetContext = vi.fn((text: string) => text.replace(/^- /gm, '1. '));
        const result = buildInsertText({
            doc: createDoc(['> a', '> b']),
            sourceBlockType: BlockType.Blockquote,
            sourceContent: '> c',
            targetLineNumber: 3,
            getBlockquoteDepthContext: () => 1,
            getContentQuoteDepth: () => 1,
            adjustBlockquoteDepth,
            adjustListToTargetContext,
        });

        expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
        expect(adjustListToTargetContext).not.toHaveBeenCalled();
        expect(result).toBe('> c\n');
    });

    it('keeps blockquote line text unchanged when moved into different quote depth context', () => {
        const adjustBlockquoteDepth = vi.fn((text: string, targetDepth: number) => `${'> '.repeat(targetDepth)}${text}`);
        const adjustListToTargetContext = vi.fn((text: string) => text.replace(/- /g, '1. '));
        const source = '> > - keep marker';
        const result = buildInsertText({
            doc: createDoc(['> context']),
            sourceBlockType: BlockType.Blockquote,
            sourceContent: source,
            targetLineNumber: 2,
            getBlockquoteDepthContext: () => 1,
            getContentQuoteDepth: () => 2,
            adjustBlockquoteDepth,
            adjustListToTargetContext,
        });

        expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
        expect(adjustListToTargetContext).not.toHaveBeenCalled();
        expect(result).toBe(`${source}\n`);
    });

    it('adds trailing blank separation when inserting plain text before a table', () => {
        const result = buildInsertText({
            doc: createDoc(['| h |', '| - |', '| v |']),
            sourceBlockType: BlockType.Paragraph,
            sourceContent: 'before table',
            targetLineNumber: 1,
            getBlockquoteDepthContext: () => 0,
            getContentQuoteDepth: () => 0,
            adjustBlockquoteDepth: (text) => text,
            adjustListToTargetContext: (text) => text,
        });

        expect(result).toBe('before table\n\n');
    });

    it('does not add leading blank separation when inserting plain text after a table', () => {
        const result = buildInsertText({
            doc: createDoc(['| h |', '| - |', '| v |']),
            sourceBlockType: BlockType.Paragraph,
            sourceContent: 'after table',
            targetLineNumber: 4,
            getBlockquoteDepthContext: () => 0,
            getContentQuoteDepth: () => 0,
            adjustBlockquoteDepth: (text) => text,
            adjustListToTargetContext: (text) => text,
        });

        expect(result).toBe('after table\n');
    });
});
