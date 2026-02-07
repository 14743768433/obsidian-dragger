import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';

type PointerDragState = {
    sourceBlock: BlockInfo;
    pointerId: number;
};

export interface DragEventHandlerDeps {
    getDragSourceBlock: (e: DragEvent) => BlockInfo | null;
    getBlockInfoForHandle: (handle: HTMLElement) => BlockInfo | null;
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    beginPointerDragSession: (blockInfo: BlockInfo) => void;
    finishDragSession: () => void;
    scheduleDropIndicatorUpdate: (clientX: number, clientY: number, dragSource: BlockInfo | null) => void;
    hideDropIndicator: () => void;
    performDropAtPoint: (sourceBlock: BlockInfo, clientX: number, clientY: number) => void;
}

export class DragEventHandler {
    private pointerDragState: PointerDragState | null = null;
    private pointerListenersAttached = false;

    private readonly onEditorPointerDown = (e: PointerEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        const handle = target.closest('.dnd-drag-handle') as HTMLElement | null;
        if (!handle) return;
        if (handle.classList.contains('dnd-embed-handle')) return;
        this.startPointerDragFromHandle(handle, e);
    };

    private readonly onEditorDragEnter = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
    };

    private readonly onEditorDragOver = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer) return;
        e.dataTransfer.dropEffect = 'move';
        this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, this.deps.getDragSourceBlock(e));
    };

    private readonly onEditorDragLeave = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        const rect = this.view.dom.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom) {
            this.deps.hideDropIndicator();
        }
    };

    private readonly onEditorDrop = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer) return;
        const sourceBlock = this.deps.getDragSourceBlock(e);
        if (!sourceBlock) return;
        this.deps.performDropAtPoint(sourceBlock, e.clientX, e.clientY);
        this.deps.hideDropIndicator();
        this.deps.finishDragSession();
    };

    private readonly onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
    private readonly onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
    private readonly onPointerCancel = (e: PointerEvent) => this.handlePointerCancel(e);

    constructor(
        private readonly view: EditorView,
        private readonly deps: DragEventHandlerDeps
    ) { }

    attach(): void {
        const editorDom = this.view.dom;
        editorDom.addEventListener('pointerdown', this.onEditorPointerDown, true);
        editorDom.addEventListener('dragenter', this.onEditorDragEnter, true);
        editorDom.addEventListener('dragover', this.onEditorDragOver, true);
        editorDom.addEventListener('dragleave', this.onEditorDragLeave, true);
        editorDom.addEventListener('drop', this.onEditorDrop, true);
    }

    startPointerDragFromHandle(handle: HTMLElement, e: PointerEvent, getBlockInfo?: () => BlockInfo | null): void {
        if (e.pointerType === 'mouse') return;
        if (this.pointerDragState) return;

        const blockInfo = getBlockInfo ? getBlockInfo() : this.deps.getBlockInfoForHandle(handle);
        if (!blockInfo) return;
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

        e.preventDefault();
        e.stopPropagation();
        this.pointerDragState = { sourceBlock: blockInfo, pointerId: e.pointerId };
        this.deps.beginPointerDragSession(blockInfo);
        this.attachPointerListeners();
        this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, blockInfo);
    }

    destroy(): void {
        this.pointerDragState = null;
        this.detachPointerListeners();

        const editorDom = this.view.dom;
        editorDom.removeEventListener('pointerdown', this.onEditorPointerDown, true);
        editorDom.removeEventListener('dragenter', this.onEditorDragEnter, true);
        editorDom.removeEventListener('dragover', this.onEditorDragOver, true);
        editorDom.removeEventListener('dragleave', this.onEditorDragLeave, true);
        editorDom.removeEventListener('drop', this.onEditorDrop, true);
    }

    private shouldHandleDrag(e: DragEvent): boolean {
        if (!e.dataTransfer) return false;
        return Array.from(e.dataTransfer.types).includes('application/dnd-block');
    }

    private attachPointerListeners(): void {
        if (this.pointerListenersAttached) return;
        window.addEventListener('pointermove', this.onPointerMove, { passive: false });
        window.addEventListener('pointerup', this.onPointerUp, { passive: false });
        window.addEventListener('pointercancel', this.onPointerCancel, { passive: false });
        this.pointerListenersAttached = true;
    }

    private detachPointerListeners(): void {
        if (!this.pointerListenersAttached) return;
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerCancel);
        this.pointerListenersAttached = false;
    }

    private handlePointerMove(e: PointerEvent): void {
        const state = this.pointerDragState;
        if (!state || e.pointerId !== state.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, state.sourceBlock);
    }

    private finishPointerDrag(e: PointerEvent, shouldDrop: boolean): void {
        const state = this.pointerDragState;
        if (!state || e.pointerId !== state.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        if (shouldDrop) {
            this.deps.performDropAtPoint(state.sourceBlock, e.clientX, e.clientY);
        }
        this.pointerDragState = null;
        this.detachPointerListeners();
        this.deps.hideDropIndicator();
        this.deps.finishDragSession();
    }

    private handlePointerUp(e: PointerEvent): void {
        this.finishPointerDrag(e, true);
    }

    private handlePointerCancel(e: PointerEvent): void {
        this.finishPointerDrag(e, false);
    }
}
