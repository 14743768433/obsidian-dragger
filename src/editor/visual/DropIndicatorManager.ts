import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { DropTargetInfo } from '../core/protocol-types';
import { DROP_INDICATOR_CLASS, DROP_HIGHLIGHT_CLASS } from '../core/selectors';

type DropTargetResolver = (info: {
    clientX: number;
    clientY: number;
    dragSource: BlockInfo | null;
    pointerType: string | null;
}) => DropTargetInfo | null;

interface DropIndicatorManagerOptions {
    onFrameMetrics?: (metrics: {
        evaluated: boolean;
        skipped: boolean;
        reused: boolean;
        durationMs: number;
    }) => void;
    recordPerfDuration?: (key: 'drop_indicator_resolve', durationMs: number) => void;
}

export class DropIndicatorManager {
    private readonly indicatorEl: HTMLDivElement;
    private readonly highlightEl: HTMLDivElement;
    private pendingDragInfo: { x: number; y: number; dragSource: BlockInfo | null; pointerType: string | null } | null = null;
    private rafId: number | null = null;
    private lastEvaluatedInput: { x: number; y: number; dragSource: BlockInfo | null; pointerType: string | null } | null = null;
    private lastTargetInfo: DropTargetInfo | null = null;

    constructor(
        private readonly view: EditorView,
        private readonly resolveDropTarget: DropTargetResolver,
        private readonly options?: DropIndicatorManagerOptions
    ) {
        this.indicatorEl = document.createElement('div');
        this.indicatorEl.className = `${DROP_INDICATOR_CLASS} dnd-hidden`;
        document.body.appendChild(this.indicatorEl);

        this.highlightEl = document.createElement('div');
        this.highlightEl.className = `${DROP_HIGHLIGHT_CLASS} dnd-hidden`;
        document.body.appendChild(this.highlightEl);
    }

    scheduleFromPoint(clientX: number, clientY: number, dragSource: BlockInfo | null, pointerType: string | null): void {
        this.pendingDragInfo = { x: clientX, y: clientY, dragSource, pointerType };
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            const pending = this.pendingDragInfo;
            if (!pending) return;
            this.updateFromPoint(pending);
        });
    }

    hide(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingDragInfo = null;
        this.lastEvaluatedInput = null;
        this.lastTargetInfo = null;
        this.indicatorEl.classList.add('dnd-hidden');
        this.highlightEl.classList.add('dnd-hidden');
    }

    destroy(): void {
        this.hide();
        this.indicatorEl.remove();
        this.highlightEl.remove();
    }

    private updateFromPoint(info: { x: number; y: number; dragSource: BlockInfo | null; pointerType: string | null }): void {
        if (this.shouldReuseLastResult(info)) {
            const reused = this.lastTargetInfo !== null;
            if (this.lastTargetInfo) {
                this.renderTargetInfo(this.lastTargetInfo);
            } else {
                this.indicatorEl.classList.add('dnd-hidden');
                this.highlightEl.classList.add('dnd-hidden');
            }
            this.options?.onFrameMetrics?.({
                evaluated: false,
                skipped: true,
                reused,
                durationMs: 0,
            });
            return;
        }

        const startedAt = this.now();
        const targetInfo = this.resolveDropTarget({
            clientX: info.x,
            clientY: info.y,
            dragSource: info.dragSource,
            pointerType: info.pointerType,
        });
        const durationMs = this.now() - startedAt;
        this.options?.recordPerfDuration?.('drop_indicator_resolve', durationMs);
        this.options?.onFrameMetrics?.({
            evaluated: true,
            skipped: false,
            reused: false,
            durationMs,
        });
        this.lastEvaluatedInput = { ...info };
        this.lastTargetInfo = targetInfo;
        if (!targetInfo) {
            this.indicatorEl.classList.add('dnd-hidden');
            this.highlightEl.classList.add('dnd-hidden');
            return;
        }
        this.renderTargetInfo(targetInfo);
    }

    private renderTargetInfo(targetInfo: DropTargetInfo): void {
        const editorRect = this.view.dom.getBoundingClientRect();
        const indicatorY = targetInfo.indicatorY;
        const indicatorLeft = targetInfo.lineRect ? targetInfo.lineRect.left : editorRect.left + 35;
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const contentPaddingRight = parseFloat(getComputedStyle(this.view.contentDOM).paddingRight) || 0;
        const indicatorRight = contentRect.right - contentPaddingRight;
        const indicatorWidth = Math.max(8, indicatorRight - indicatorLeft);

        this.indicatorEl.classList.remove('dnd-hidden');
        this.indicatorEl.setCssStyles({
            top: `${indicatorY}px`,
            left: `${indicatorLeft}px`,
            width: `${indicatorWidth}px`,
        });

        if (targetInfo.highlightRect) {
            this.highlightEl.classList.remove('dnd-hidden');
            this.highlightEl.setCssStyles({
                top: `${targetInfo.highlightRect.top}px`,
                left: `${targetInfo.highlightRect.left}px`,
                width: `${targetInfo.highlightRect.width}px`,
                height: `${targetInfo.highlightRect.height}px`,
            });
        } else {
            this.highlightEl.classList.add('dnd-hidden');
        }
    }

    private shouldReuseLastResult(info: { x: number; y: number; dragSource: BlockInfo | null; pointerType: string | null }): boolean {
        if (!this.lastEvaluatedInput) return false;
        if (this.lastEvaluatedInput.pointerType !== info.pointerType) return false;
        if (!this.isSameSourceBlock(this.lastEvaluatedInput.dragSource, info.dragSource)) return false;
        const dx = Math.abs(this.lastEvaluatedInput.x - info.x);
        const dy = Math.abs(this.lastEvaluatedInput.y - info.y);
        return dx + dy < 2;
    }

    private isSameSourceBlock(a: BlockInfo | null, b: BlockInfo | null): boolean {
        if (a === b) return true;
        if (!a || !b) return false;
        return a.type === b.type
            && a.startLine === b.startLine
            && a.endLine === b.endLine
            && a.from === b.from
            && a.to === b.to;
    }

    private now(): number {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }
}
