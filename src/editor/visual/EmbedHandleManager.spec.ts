// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockType } from '../../types';
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
    it('debounces non-urgent scans', () => {
        vi.useFakeTimers();
        const view = createViewStub();
        const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((_cb: FrameRequestCallback) => 7);
        const manager = new EmbedHandleManager(view, {
            createHandleElement: () => document.createElement('div'),
            resolveBlockInfoForEmbed: () => null,
        });

        manager.scheduleScan();
        manager.scheduleScan();
        expect(rafSpy).toHaveBeenCalledTimes(0);
        vi.runOnlyPendingTimers();
        expect(rafSpy).toHaveBeenCalledTimes(1);

        manager.destroy();
        vi.useRealTimers();
    });

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

        manager.scheduleScan({ urgent: true });
        expect(rafSpy).toHaveBeenCalledTimes(1);
        manager.destroy();

        expect(cancelSpy).toHaveBeenCalledWith(7);
        queued?.(0);
        expect(rescanSpy).not.toHaveBeenCalled();
    });

    it('skips embed handle when an inline line handle already exists for the same block', () => {
        const view = createViewStub();
        const embed = document.createElement('div');
        embed.className = 'cm-callout';
        view.dom.appendChild(embed);

        const inlineHandle = document.createElement('div');
        inlineHandle.className = 'dnd-drag-handle dnd-line-handle';
        inlineHandle.setAttribute('data-block-start', '0');
        view.dom.appendChild(inlineHandle);

        const createHandleElement = vi.fn(() => document.createElement('div'));
        const manager = new EmbedHandleManager(view, {
            createHandleElement,
            resolveBlockInfoForEmbed: () => ({
                type: BlockType.Callout,
                startLine: 0,
                endLine: 2,
                from: 0,
                to: 12,
                indentLevel: 0,
                content: '> [!note]\\ncontent',
            }),
        });

        manager.rescan();

        expect(createHandleElement).not.toHaveBeenCalled();
        expect(view.dom.querySelector('.dnd-embed-handle')).toBeNull();
        manager.destroy();
    });
});
