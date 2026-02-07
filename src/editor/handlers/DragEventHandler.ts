import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';

const MOBILE_DRAG_LONG_PRESS_MS = 200;
const MOBILE_DRAG_START_MOVE_THRESHOLD_PX = 8;
const MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX = 12;
const MOBILE_DRAG_HOTZONE_LEFT_PX = 24;
const MOBILE_DRAG_HOTZONE_RIGHT_PX = 8;

type PointerDragState = {
    sourceBlock: BlockInfo;
    pointerId: number;
};

type PointerPressState = {
    sourceBlock: BlockInfo;
    pointerId: number;
    startX: number;
    startY: number;
    latestX: number;
    latestY: number;
    longPressReady: boolean;
    timeoutId: number | null;
};

export interface DragEventHandlerDeps {
    getDragSourceBlock: (e: DragEvent) => BlockInfo | null;
    getBlockInfoForHandle: (handle: HTMLElement) => BlockInfo | null;
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null;
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    beginPointerDragSession: (blockInfo: BlockInfo) => void;
    finishDragSession: () => void;
    scheduleDropIndicatorUpdate: (clientX: number, clientY: number, dragSource: BlockInfo | null) => void;
    hideDropIndicator: () => void;
    performDropAtPoint: (sourceBlock: BlockInfo, clientX: number, clientY: number) => void;
}

export class DragEventHandler {
    private pointerDragState: PointerDragState | null = null;
    private pointerPressState: PointerPressState | null = null;
    private pointerListenersAttached = false;

    private readonly onEditorPointerDown = (e: PointerEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        const handle = target.closest('.dnd-drag-handle') as HTMLElement | null;
        if (handle && !handle.classList.contains('dnd-embed-handle')) {
            this.startPointerDragFromHandle(handle, e);
            return;
        }

        if (!this.shouldStartMobilePressDrag(e)) return;
        const blockInfo = this.deps.getBlockInfoAtPoint(e.clientX, e.clientY);
        if (!blockInfo) return;
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return;
        if (!this.isWithinMobileDragHotzone(blockInfo, e.clientX)) return;

        this.startPointerPressDrag(blockInfo, e);
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
        if (this.pointerDragState || this.pointerPressState) return;

        const blockInfo = getBlockInfo ? getBlockInfo() : this.deps.getBlockInfoForHandle(handle);
        if (!blockInfo) return;
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

        e.preventDefault();
        e.stopPropagation();
        this.beginPointerDrag(blockInfo, e.pointerId, e.clientX, e.clientY);
    }

    destroy(): void {
        this.pointerDragState = null;
        this.clearPointerPressState();
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

    private isCoarsePointerEnvironment(): boolean {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    }

    private shouldStartMobilePressDrag(e: PointerEvent): boolean {
        if (this.pointerDragState || this.pointerPressState) return false;
        if (e.button !== 0) return false;
        if (e.pointerType === 'mouse') return false;
        if (!this.isCoarsePointerEnvironment() && e.pointerType !== 'touch') return false;
        return true;
    }

    private isWithinMobileDragHotzone(blockInfo: BlockInfo, clientX: number): boolean {
        const lineNumber = blockInfo.startLine + 1;
        if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) return false;

        const line = this.view.state.doc.line(lineNumber);
        const lineStart = this.view.coordsAtPos(line.from);
        if (!lineStart) return false;

        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const hotzoneLeft = Math.max(contentRect.left - 2, lineStart.left - MOBILE_DRAG_HOTZONE_LEFT_PX);
        const hotzoneRight = lineStart.left + MOBILE_DRAG_HOTZONE_RIGHT_PX;
        return clientX >= hotzoneLeft && clientX <= hotzoneRight;
    }

    private startPointerPressDrag(blockInfo: BlockInfo, e: PointerEvent): void {
        const timeoutId = window.setTimeout(() => {
            const state = this.pointerPressState;
            if (!state || state.pointerId !== e.pointerId) return;
            state.longPressReady = true;
        }, MOBILE_DRAG_LONG_PRESS_MS);

        this.pointerPressState = {
            sourceBlock: blockInfo,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            latestX: e.clientX,
            latestY: e.clientY,
            longPressReady: false,
            timeoutId,
        };
        this.attachPointerListeners();
    }

    private clearPointerPressState(): void {
        const state = this.pointerPressState;
        if (!state) return;
        if (state.timeoutId !== null) {
            window.clearTimeout(state.timeoutId);
        }
        this.pointerPressState = null;
    }

    private beginPointerDrag(sourceBlock: BlockInfo, pointerId: number, clientX: number, clientY: number): void {
        this.pointerDragState = { sourceBlock, pointerId };
        this.deps.beginPointerDragSession(sourceBlock);
        this.deps.scheduleDropIndicatorUpdate(clientX, clientY, sourceBlock);
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

    private maybeDetachPointerListeners(): void {
        if (this.pointerDragState || this.pointerPressState) return;
        this.detachPointerListeners();
    }

    private handlePointerMove(e: PointerEvent): void {
        const dragState = this.pointerDragState;
        if (dragState && e.pointerId === dragState.pointerId) {
            e.preventDefault();
            e.stopPropagation();
            this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, dragState.sourceBlock);
            return;
        }

        const pressState = this.pointerPressState;
        if (!pressState || e.pointerId !== pressState.pointerId) return;

        pressState.latestX = e.clientX;
        pressState.latestY = e.clientY;

        const dx = e.clientX - pressState.startX;
        const dy = e.clientY - pressState.startY;
        const distance = Math.hypot(dx, dy);

        if (!pressState.longPressReady) {
            if (distance > MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX) {
                this.clearPointerPressState();
                this.maybeDetachPointerListeners();
            }
            return;
        }

        if (distance < MOBILE_DRAG_START_MOVE_THRESHOLD_PX) return;

        e.preventDefault();
        e.stopPropagation();
        const sourceBlock = pressState.sourceBlock;
        const pointerId = pressState.pointerId;
        this.clearPointerPressState();
        this.beginPointerDrag(sourceBlock, pointerId, e.clientX, e.clientY);
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
        this.maybeDetachPointerListeners();
        this.deps.hideDropIndicator();
        this.deps.finishDragSession();
    }

    private handlePointerUp(e: PointerEvent): void {
        if (this.pointerDragState) {
            this.finishPointerDrag(e, true);
            return;
        }

        const pressState = this.pointerPressState;
        if (!pressState || e.pointerId !== pressState.pointerId) return;
        this.clearPointerPressState();
        this.maybeDetachPointerListeners();
    }

    private handlePointerCancel(e: PointerEvent): void {
        if (this.pointerDragState) {
            this.finishPointerDrag(e, false);
            return;
        }

        const pressState = this.pointerPressState;
        if (!pressState || e.pointerId !== pressState.pointerId) return;
        this.clearPointerPressState();
        this.maybeDetachPointerListeners();
    }
}
