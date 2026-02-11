// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
    getHandleColumnCenterX,
    setHandleHorizontalOffsetPx,
    viewportXToEditorLocalX,
    viewportYToEditorLocalY,
} from './handle-position';

type RectLike = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    x: number;
    y: number;
    toJSON: () => Record<string, never>;
};

function createRect(left: number, top: number, width: number, height: number): RectLike {
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
    };
}

function setRect(el: HTMLElement, left: number, top: number, width: number, height: number): void {
    Object.defineProperty(el, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(left, top, width, height),
    });
}

afterEach(() => {
    setHandleHorizontalOffsetPx(0);
    document.body.innerHTML = '';
});

describe('handle-position', () => {
    it('anchors to the current editor line-number gutter and centers inside gutterElement paddings', () => {
        const root = document.createElement('div');
        root.className = 'cm-editor';

        const nestedEditor = document.createElement('div');
        nestedEditor.className = 'cm-editor';
        const nestedGutter = document.createElement('div');
        nestedGutter.className = 'cm-gutter cm-lineNumbers';
        const nestedRow = document.createElement('div');
        nestedRow.className = 'cm-gutterElement';
        nestedRow.textContent = '1';
        nestedGutter.appendChild(nestedRow);
        nestedEditor.appendChild(nestedGutter);
        root.appendChild(nestedEditor);

        const scroller = document.createElement('div');
        scroller.className = 'cm-scroller';
        const gutters = document.createElement('div');
        gutters.className = 'cm-gutters';
        const mainGutter = document.createElement('div');
        mainGutter.className = 'cm-gutter cm-lineNumbers';
        const mainRow = document.createElement('div');
        mainRow.className = 'cm-gutterElement';
        mainRow.textContent = '7';
        mainRow.setCssStyles({
            paddingLeft: '12px',
            paddingRight: '4px',
        });
        mainGutter.appendChild(mainRow);
        gutters.appendChild(mainGutter);
        scroller.appendChild(gutters);
        root.appendChild(scroller);

        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 220);
        setRect(content, 80, 0, 280, 220);
        setRect(nestedGutter, 10, 0, 30, 220);
        setRect(nestedRow, 10, 20, 30, 20);
        setRect(mainGutter, 96, 0, 52, 220);
        setRect(mainRow, 100, 20, 40, 20);

        const view = {
            dom: root,
            contentDOM: content,
        } as unknown as EditorView;

        expect(getHandleColumnCenterX(view)).toBeCloseTo(124, 3);
        setHandleHorizontalOffsetPx(6);
        expect(getHandleColumnCenterX(view)).toBeCloseTo(130, 3);
    });

    it('converts viewport coordinates into local editor coordinates with scale and client border', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        setRect(root, 100, 50, 200, 160);

        Object.defineProperty(root, 'offsetWidth', { configurable: true, value: 100 });
        Object.defineProperty(root, 'offsetHeight', { configurable: true, value: 80 });
        Object.defineProperty(root, 'clientLeft', { configurable: true, value: 3 });
        Object.defineProperty(root, 'clientTop', { configurable: true, value: 5 });

        const view = { dom: root } as unknown as EditorView;
        expect(viewportXToEditorLocalX(view, 140)).toBeCloseTo(17, 6);
        expect(viewportYToEditorLocalY(view, 90)).toBeCloseTo(15, 6);
    });
});
