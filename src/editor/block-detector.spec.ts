import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { BlockType } from '../types';
import { detectBlock, getHeadingSectionRange } from './block-detector';

function createState(doc: string): EditorState {
    return EditorState.create({ doc });
}

describe('block-detector', () => {
    it('does not absorb following plain text into a list item block', () => {
        const state = createState('- item\nplain text');
        const block = detectBlock(state, 1);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.ListItem);
        expect(block?.startLine).toBe(0);
        expect(block?.endLine).toBe(0);
    });

    it('keeps indented continuation inside list item block', () => {
        const state = createState('- item\n  continuation\nplain text');
        const block = detectBlock(state, 1);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.ListItem);
        expect(block?.endLine).toBe(1);
    });

    it('does not absorb following plain text into a task item block', () => {
        const state = createState('- [ ] task\nplain text');
        const block = detectBlock(state, 1);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.ListItem);
        expect(block?.endLine).toBe(0);
    });

    it('treats regular blockquote lines as line-level movable blocks', () => {
        const state = createState('> line 1\n> line 2\n> line 3\noutside');
        const block = detectBlock(state, 2);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.Blockquote);
        expect(block?.startLine).toBe(1);
        expect(block?.endLine).toBe(1);
    });

    it('treats quote lines with list markers as part of one blockquote container', () => {
        const state = createState('> intro\n> - item\n> continuation');
        const block = detectBlock(state, 2);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.Blockquote);
        expect(block?.startLine).toBe(1);
        expect(block?.endLine).toBe(1);
    });

    it('keeps callout as one container block when hit from body lines', () => {
        const state = createState('> [!note] title\n> body line 1\n> body line 2\noutside');
        const block = detectBlock(state, 2);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.Callout);
        expect(block?.startLine).toBe(0);
        expect(block?.endLine).toBe(2);
    });

    it('returns heading section range until next same-or-higher heading', () => {
        const state = createState('# H1\nparagraph\n## H2\nsub\n# H1-2\ntail');
        const range = getHeadingSectionRange(state.doc, 1);

        expect(range).toEqual({ startLine: 1, endLine: 4 });
    });

    it('returns nested heading section range for child heading', () => {
        const state = createState('# H1\nintro\n## H2\ndetail\n### H3\ndeep\n## H2 next');
        const range = getHeadingSectionRange(state.doc, 3);

        expect(range).toEqual({ startLine: 3, endLine: 6 });
    });
});
