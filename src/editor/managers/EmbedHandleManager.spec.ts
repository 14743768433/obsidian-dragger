// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbedHandleManager } from './EmbedHandleManager';

function createViewStub(): EditorView {
    const dom = document.createElement('div');
    dom.className = 'cm-editor';
    const scrollDOM = document.createElement('div');
    dom.appendChild(scrollDOM);
    document.body.appendChild(dom);

    return {
        dom,
        scrollDOM,
        state: {
            doc: {
                lines: 1,
                line: () => ({ text: 'line' }),
            },
        },
        defaultLineHeight: 20,
    } as unknown as EditorView;
}

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('EmbedHandleManager', () => {
    it('cancels scheduled RAF scan during destroy and ignores stale callback', () => {
        const view = createViewStub();
        let queued: FrameRequestCallback | null = null;
        const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            queued = cb;
            return 7;
        });
        const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id: number) => {
            if (id === 7) {
                queued = null;
            }
        });

        const manager = new EmbedHandleManager(view, {
            createHandleElement: () => document.createElement('div'),
            resolveBlockInfoForEmbed: () => null,
        });
        const rescanSpy = vi.spyOn(manager, 'rescan');

        manager.scheduleScan();
        expect(rafSpy).toHaveBeenCalledTimes(1);
        manager.destroy();

        expect(cancelSpy).toHaveBeenCalledWith(7);
        queued?.(0);
        expect(rescanSpy).not.toHaveBeenCalled();
    });
});
