// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { HandleVisibilityController } from './HandleVisibilityController';
import { BLOCK_SELECTION_ACTIVE_CLASS } from '../core/constants';

function createViewStub(lineCount: number): EditorView {
    const root = document.createElement('div');
    const content = document.createElement('div');
    root.appendChild(content);
    document.body.appendChild(root);

    const state = EditorState.create({
        doc: Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join('\n'),
    });

    const lineElements: HTMLElement[] = [];
    for (let i = 0; i < lineCount; i++) {
        const lineEl = document.createElement('div');
        lineEl.className = 'cm-line';
        lineEl.textContent = `line ${i + 1}`;
        content.appendChild(lineEl);
        lineElements.push(lineEl);
    }

    return {
        dom: root,
        contentDOM: content,
        state,
        domAtPos: (pos: number) => {
            const line = state.doc.lineAt(pos);
            const node = lineElements[Math.max(0, line.number - 1)] ?? content;
            return { node, offset: 0 };
        },
    } as unknown as EditorView;
}

describe('HandleVisibilityController', () => {
    it('clears selection highlight when grabbed line numbers are cleared', () => {
        const view = createViewStub(5);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getDraggableBlockAtPoint: () => null,
        });

        controller.enterGrabVisualState(2, 4, null);

        expect(view.dom.querySelectorAll('.dnd-selection-highlight-line').length).toBe(3);

        controller.clearGrabbedLineNumbers();

        expect(view.dom.querySelectorAll('.dnd-selection-highlight-line').length).toBe(0);
    });

    it('keeps only anchor handle visible while block selection is active', () => {
        const view = createViewStub(6);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getDraggableBlockAtPoint: () => null,
        });

        const anchorHandle = document.createElement('div');
        anchorHandle.className = 'dnd-drag-handle';
        anchorHandle.setAttribute('data-block-start', '2');
        const otherHandle = document.createElement('div');
        otherHandle.className = 'dnd-drag-handle';
        otherHandle.setAttribute('data-block-start', '4');
        view.dom.appendChild(anchorHandle);
        view.dom.appendChild(otherHandle);

        controller.setHiddenRangesForSelection([{ startLineNumber: 3, endLineNumber: 3 }], anchorHandle);

        expect(document.body.classList.contains(BLOCK_SELECTION_ACTIVE_CLASS)).toBe(true);
        expect(anchorHandle.classList.contains('dnd-selection-anchor-handle')).toBe(true);
        expect(anchorHandle.classList.contains('dnd-selection-handle-hidden')).toBe(false);
        expect(otherHandle.classList.contains('dnd-selection-handle-hidden')).toBe(true);
    });

    it('restores handle visibility classes after block selection is cleared', () => {
        const view = createViewStub(6);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getDraggableBlockAtPoint: () => null,
        });

        const anchorHandle = document.createElement('div');
        anchorHandle.className = 'dnd-drag-handle';
        anchorHandle.setAttribute('data-block-start', '1');
        const otherHandle = document.createElement('div');
        otherHandle.className = 'dnd-drag-handle';
        otherHandle.setAttribute('data-block-start', '3');
        view.dom.appendChild(anchorHandle);
        view.dom.appendChild(otherHandle);

        controller.setHiddenRangesForSelection([{ startLineNumber: 2, endLineNumber: 2 }], anchorHandle);
        controller.clearHiddenRangesForSelection();

        expect(document.body.classList.contains(BLOCK_SELECTION_ACTIVE_CLASS)).toBe(false);
        expect(anchorHandle.classList.contains('dnd-selection-anchor-handle')).toBe(false);
        expect(anchorHandle.classList.contains('dnd-selection-handle-hidden')).toBe(false);
        expect(otherHandle.classList.contains('dnd-selection-anchor-handle')).toBe(false);
        expect(otherHandle.classList.contains('dnd-selection-handle-hidden')).toBe(false);
    });
});
