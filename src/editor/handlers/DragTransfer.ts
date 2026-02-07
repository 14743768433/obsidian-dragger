import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import {
    clearActiveDragSourceBlock,
    getActiveDragSourceBlock,
    hideDropVisuals,
    setActiveDragSourceBlock,
} from '../core/session';
import { isPosInsideRenderedTableCell } from '../core/table-guard';

export function beginDragSession(blockInfo: BlockInfo): void {
    setActiveDragSourceBlock(blockInfo);
    document.body.classList.add('dnd-dragging');
}

export function finishDragSession(): void {
    clearActiveDragSourceBlock();
    document.body.classList.remove('dnd-dragging');
    hideDropVisuals();
}

export function startDragFromHandle(
    e: DragEvent,
    view: EditorView,
    resolveBlockInfo: () => BlockInfo | null,
    handle?: HTMLElement | null
): void {
    if (!e.dataTransfer) return;
    const blockInfo = resolveBlockInfo();
    if (!blockInfo) {
        e.preventDefault();
        return;
    }
    if (isPosInsideRenderedTableCell(view, blockInfo.from, { skipLayoutRead: true })) {
        e.preventDefault();
        return;
    }
    startDragWithBlockInfo(e, blockInfo, handle ?? null);
}

export function getDragSourceBlockFromEvent(e: DragEvent): BlockInfo | null {
    if (!e.dataTransfer) return getActiveDragSourceBlock();
    const data = e.dataTransfer.getData('application/dnd-block');
    if (!data) return getActiveDragSourceBlock();
    try {
        return JSON.parse(data) as BlockInfo;
    } catch {
        return getActiveDragSourceBlock();
    }
}

function startDragWithBlockInfo(e: DragEvent, blockInfo: BlockInfo, handle?: HTMLElement | null): void {
    if (!e.dataTransfer) return;
    beginDragSession(blockInfo);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', blockInfo.content);
    e.dataTransfer.setData('application/dnd-block', JSON.stringify(blockInfo));

    if (handle) {
        handle.setAttribute('data-block-start', String(blockInfo.startLine));
        handle.setAttribute('data-block-end', String(blockInfo.endLine));
    }

    const ghost = document.createElement('div');
    ghost.className = 'dnd-drag-ghost';
    ghost.textContent = blockInfo.content.slice(0, 50) + (blockInfo.content.length > 50 ? '...' : '');
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => ghost.remove(), 0);
}
