import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { getLineMap, getLineMetaAt } from './line-map';

describe('line-map', () => {
    it('builds line metadata and non-empty indexes', () => {
        const state = EditorState.create({
            doc: '> [!note] title\n> body\n\n- item\n---\n| a |',
        });
        const lineMap = getLineMap(state);

        expect(getLineMetaAt(lineMap, 1)).toEqual(expect.objectContaining({
            isQuote: true,
            isCallout: true,
            isEmpty: false,
        }));
        expect(getLineMetaAt(lineMap, 3)).toEqual(expect.objectContaining({
            isEmpty: true,
        }));
        expect(getLineMetaAt(lineMap, 4)).toEqual(expect.objectContaining({
            isList: true,
        }));
        expect(getLineMetaAt(lineMap, 5)).toEqual(expect.objectContaining({
            isHr: true,
        }));
        expect(getLineMetaAt(lineMap, 6)).toEqual(expect.objectContaining({
            isTable: true,
        }));
        expect(lineMap.prevNonEmpty[3]).toBe(2);
        expect(lineMap.nextNonEmpty[3]).toBe(4);
    });

    it('builds list parent/subtree indexes', () => {
        const state = EditorState.create({
            doc: '- root\n  - child\n    detail\n- sibling\nafter',
        });
        const lineMap = getLineMap(state);

        expect(lineMap.listParentLine[1]).toBe(0);
        expect(lineMap.listParentLine[2]).toBe(1);
        expect(lineMap.listSubtreeEndLine[2]).toBe(3);
        expect(lineMap.listSubtreeEndLine[1]).toBe(3);
        expect(lineMap.prevListLine[4]).toBe(2);
        expect(lineMap.prevListLine[5]).toBe(4);
    });

    it('reuses cached line map across states sharing the same doc', () => {
        const stateA = EditorState.create({ doc: '- item' });
        const first = getLineMap(stateA);
        const stateB = EditorState.create({ doc: stateA.doc });
        const second = getLineMap(stateB);
        const stateC = EditorState.create({ doc: '- item\n- next' });

        expect(first).toBe(second);
        expect(getLineMap(stateC)).not.toBe(first);
    });
});
