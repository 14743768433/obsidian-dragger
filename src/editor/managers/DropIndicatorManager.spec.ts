// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockType } from '../../types';
import { DropIndicatorManager } from './DropIndicatorManager';

function createViewStub(): EditorView {
    const root = document.createElement('div');
    const content = document.createElement('div');
    root.appendChild(content);
    document.body.appendChild(root);
    Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }),
    });
    Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 0, top: 0, right: 380, bottom: 180, width: 380, height: 180 }),
    });
    return {
        dom: root,
        contentDOM: content,
    } as unknown as EditorView;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('DropIndicatorManager', () => {
    it('skips target recalculation for tiny pointer moves on same source', () => {
        const view = createViewStub();
        const resolveDropTarget = vi.fn(() => ({
            lineNumber: 1,
            indicatorY: 10,
            lineRect: { left: 5, width: 100 },
        }));
        const onFrameMetrics = vi.fn();
        const queuedFrames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            queuedFrames.push(cb);
            return queuedFrames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { });
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({ paddingRight: '0' } as any);

        const manager = new DropIndicatorManager(view, resolveDropTarget, { onFrameMetrics });
        const source = {
            type: BlockType.Paragraph,
            startLine: 0,
            endLine: 0,
            from: 0,
            to: 5,
            indentLevel: 0,
            content: 'plain',
        };

        manager.scheduleFromPoint(10, 10, source, 'mouse');
        queuedFrames.shift()?.(0);
        manager.scheduleFromPoint(11, 10, source, 'mouse');
        queuedFrames.shift()?.(16);

        expect(resolveDropTarget).toHaveBeenCalledTimes(1);
        expect(onFrameMetrics).toHaveBeenCalledTimes(2);
        expect(onFrameMetrics).toHaveBeenLastCalledWith(
            expect.objectContaining({
                evaluated: false,
                skipped: true,
                reused: true,
            })
        );

        manager.destroy();
    });
});
