// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { HandleVisibilityController } from './HandleVisibilityController';

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
});
