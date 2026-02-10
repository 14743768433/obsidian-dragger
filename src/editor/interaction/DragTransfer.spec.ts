// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockInfo, BlockType } from '../../types';
import {
    beginDragSession,
    finishDragSession,
    getDragSourceBlockFromEvent,
} from './DragTransfer';
import { getActiveDragSourceBlock } from '../core/session';

function createViewStub(docText = 'line'): EditorView {
    const state = EditorState.create({ doc: docText });
    const dom = document.createElement('div');
    dom.className = 'cm-editor dnd-root-editor';
    const contentDOM = document.createElement('div');
    contentDOM.className = 'cm-content';
    dom.appendChild(contentDOM);
    document.body.appendChild(dom);

    return {
        state,
        dom,
        contentDOM,
    } as unknown as EditorView;
}

function createBlock(content: string, startLine: number): BlockInfo {
    return {
        type: BlockType.Paragraph,
        startLine,
        endLine: startLine,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

afterEach(() => {
    finishDragSession();
    document.body.innerHTML = '';
});

describe('DragTransfer session scoping', () => {
    it('keeps drag source state isolated per editor view', () => {
        const viewA = createViewStub('a');
        const viewB = createViewStub('b');
        const blockA = createBlock('A', 0);
        const blockB = createBlock('B', 0);

        beginDragSession(blockA, viewA);
        beginDragSession(blockB, viewB);

        expect(document.body.classList.contains('dnd-dragging')).toBe(true);
        expect(getActiveDragSourceBlock(viewA)?.content).toBe('A');
        expect(getActiveDragSourceBlock(viewB)?.content).toBe('B');

        finishDragSession(viewA);
        expect(getActiveDragSourceBlock(viewA)).toBeNull();
        expect(getActiveDragSourceBlock(viewB)?.content).toBe('B');
        expect(document.body.classList.contains('dnd-dragging')).toBe(true);

        finishDragSession(viewB);
        expect(document.body.classList.contains('dnd-dragging')).toBe(false);
    });

    it('falls back to the current view session when drag event carries no dataTransfer payload', () => {
        const view = createViewStub('line');
        const block = createBlock('local-block', 0);
        beginDragSession(block, view);

        const event = new Event('dragover') as DragEvent;
        const resolved = getDragSourceBlockFromEvent(event, view);

        expect(resolved?.content).toBe('local-block');
    });
});
