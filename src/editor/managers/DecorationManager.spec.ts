import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { BlockType } from '../../types';
import { DecorationManager } from './DecorationManager';
import { detectBlock, getListItemOwnRangeForHandle } from '../block-detector';

vi.mock('../block-detector', () => ({
    detectBlock: vi.fn(),
    getListItemOwnRangeForHandle: vi.fn(),
}));

function createViewStub(docText: string): EditorView {
    const state = EditorState.create({ doc: docText });
    return {
        state,
        visibleRanges: [{ from: 0, to: state.doc.length }],
    } as unknown as EditorView;
}

function countDecorations(set: ReturnType<DecorationManager['buildDecorations']>, maxTo: number): number {
    let count = 0;
    set.between(0, maxTo, () => {
        count += 1;
    });
    return count;
}

describe('DecorationManager', () => {
    it('renders one handle for a multi-line block within the viewport', () => {
        const view = createViewStub('h1\nline2\nline3');
        const detectMock = vi.mocked(detectBlock);
        const ownRangeMock = vi.mocked(getListItemOwnRangeForHandle);
        ownRangeMock.mockReturnValue(null);
        detectMock.mockImplementation((state, lineNumber) => {
            if (lineNumber < 1 || lineNumber > 3) return null;
            return {
                type: BlockType.Heading,
                startLine: 0,
                endLine: 2,
                from: 0,
                to: state.doc.length,
                indentLevel: 0,
                content: 'h1\nline2\nline3',
            };
        });

        const manager = new DecorationManager({
            view,
            createHandleElement: () => document.createElement('div'),
            getDraggableBlockAtLine: () => null,
        });
        const decorations = manager.buildDecorations();

        expect(countDecorations(decorations, view.state.doc.length + 1)).toBe(1);
    });

    it('skips duplicate handles across list own-range lines', () => {
        const view = createViewStub('- a\n  text\n  text2');
        const detectMock = vi.mocked(detectBlock);
        const ownRangeMock = vi.mocked(getListItemOwnRangeForHandle);
        ownRangeMock.mockImplementation((_state, lineNumber) =>
            lineNumber === 1 ? { startLine: 1, endLine: 3 } : null
        );
        detectMock.mockImplementation((state, lineNumber) => {
            if (lineNumber < 1 || lineNumber > 3) return null;
            return {
                type: BlockType.ListItem,
                startLine: 0,
                endLine: 2,
                from: 0,
                to: state.doc.length,
                indentLevel: 0,
                content: '- a\n  text\n  text2',
            };
        });

        const manager = new DecorationManager({
            view,
            createHandleElement: () => document.createElement('div'),
            getDraggableBlockAtLine: () => null,
        });
        const decorations = manager.buildDecorations();

        expect(countDecorations(decorations, view.state.doc.length + 1)).toBe(1);
    });
});
