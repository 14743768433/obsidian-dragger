import { Extension } from '@codemirror/state';
import {
    EditorView,
    ViewPlugin,
    ViewUpdate,
    DecorationSet,
} from '@codemirror/view';
import { BlockInfo } from '../types';
import DragNDropPlugin from '../main';
import {
    ROOT_EDITOR_CLASS,
    MAIN_EDITOR_CONTENT_CLASS,
} from './core/selectors';
import {
    getActiveDragSourceBlock,
} from './core/session';
import {
    isPosInsideRenderedTableCell,
} from './core/table-guard';
import { getPreviousNonEmptyLineNumber as getPreviousNonEmptyLineNumberInDoc } from './core/container-policy';
import { BlockMover } from './movers/BlockMover';
import { DropIndicatorManager } from './managers/DropIndicatorManager';
import { DropTargetCalculator } from './handlers/DropTargetCalculator';
import { DragEventHandler } from './handlers/DragEventHandler';
import { DragSourceResolver } from './handlers/DragSourceResolver';
import { DropPolicyAdapter } from './handlers/DropPolicyAdapter';
import {
    beginDragSession,
    finishDragSession,
    getDragSourceBlockFromEvent,
    startDragFromHandle,
} from './handlers/DragTransfer';
import { createDragHandleElement } from './core/handle-dom';
import { DecorationManager } from './managers/DecorationManager';
import { EmbedHandleManager } from './managers/EmbedHandleManager';
import { clampNumber, clampTargetLineNumber } from './utils/coordinate-utils';

/**
 * 创建拖拽手柄ViewPlugin
 */
function createDragHandleViewPlugin(_plugin: DragNDropPlugin) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            view: EditorView;
            dropIndicator: DropIndicatorManager;
            blockMover: BlockMover;
            dropTargetCalculator: DropTargetCalculator;
            dropPolicy: DropPolicyAdapter;
            decorationManager: DecorationManager;
            embedHandleManager: EmbedHandleManager;
            dragEventHandler: DragEventHandler;
            dragSourceResolver: DragSourceResolver;

            constructor(view: EditorView) {
                this.view = view;
                this.view.dom.classList.add(ROOT_EDITOR_CLASS);
                this.view.contentDOM.classList.add(MAIN_EDITOR_CONTENT_CLASS);
                this.dragSourceResolver = new DragSourceResolver(this.view);
                this.dropPolicy = new DropPolicyAdapter(this.view);
                this.dropTargetCalculator = new DropTargetCalculator(this.view, {
                    parseLineWithQuote: this.dropPolicy.parseLineWithQuote.bind(this.dropPolicy),
                    getAdjustedTargetLocation: (_view, lineNumber, options) =>
                        this.dropPolicy.getAdjustedTargetLocation(lineNumber, options),
                    clampTargetLineNumber,
                    getPreviousNonEmptyLineNumber: getPreviousNonEmptyLineNumberInDoc,
                    shouldPreventDropIntoDifferentContainer: (_view, sourceBlock, targetLineNumber) =>
                        this.dropPolicy.shouldPreventDropIntoDifferentContainer(sourceBlock, targetLineNumber),
                    getBlockInfoForEmbed: (_view, embedEl) => this.dragSourceResolver.getBlockInfoForEmbed(embedEl),
                    getIndentUnitWidthForDoc: (doc, state) => this.dropPolicy.getIndentUnitWidthForDoc(doc, state),
                    getLineRect: (_view, lineNumber) => this.dropPolicy.getLineRect(lineNumber),
                    getInsertionAnchorY: (_view, lineNumber) => this.dropPolicy.getInsertionAnchorY(lineNumber),
                    getLineIndentPosByWidth: (_view, lineNumber, targetIndentWidth) =>
                        this.dropPolicy.getLineIndentPosByWidth(lineNumber, targetIndentWidth),
                    getBlockRect: (_view, startLineNumber, endLineNumber) =>
                        this.dropPolicy.getBlockRect(startLineNumber, endLineNumber),
                    clampNumber,
                });
                this.dropIndicator = new DropIndicatorManager(view, (info) =>
                    this.dropTargetCalculator.getDropTargetInfo({
                        clientX: info.clientX,
                        clientY: info.clientY,
                        dragSource: info.dragSource ?? getActiveDragSourceBlock() ?? null,
                    })
                );
                this.blockMover = new BlockMover({
                    view: this.view,
                    clampTargetLineNumber,
                    getAdjustedTargetLocation: (_view, lineNumber, options) =>
                        this.dropPolicy.getAdjustedTargetLocation(lineNumber, options),
                    shouldPreventDropIntoDifferentContainer: (_view, sourceBlock, targetLineNumber) =>
                        this.dropPolicy.shouldPreventDropIntoDifferentContainer(sourceBlock, targetLineNumber),
                    parseLineWithQuote: this.dropPolicy.parseLineWithQuote.bind(this.dropPolicy),
                    getListContext: this.dropPolicy.getListContext.bind(this.dropPolicy),
                    getIndentUnitWidth: this.dropPolicy.getIndentUnitWidth.bind(this.dropPolicy),
                    buildInsertText: this.dropPolicy.buildInsertText.bind(this.dropPolicy),
                });
                this.decorationManager = new DecorationManager({
                    view: this.view,
                    getDraggableBlockAtLine: (lineNumber) => this.dragSourceResolver.getDraggableBlockAtLine(lineNumber),
                    startDragFromHandle: (e, resolveBlockInfo, handle) =>
                        startDragFromHandle(e, this.view, resolveBlockInfo, handle),
                    finishDragSession: () => finishDragSession(),
                });
                this.embedHandleManager = new EmbedHandleManager(this.view, {
                    createHandleElement: this.createHandleElement.bind(this),
                    resolveBlockInfoForEmbed: (embedEl) => this.dragSourceResolver.getBlockInfoForEmbed(embedEl),
                });
                this.dragEventHandler = new DragEventHandler(this.view, {
                    getDragSourceBlock: getDragSourceBlockFromEvent,
                    getBlockInfoForHandle: (handle) => this.dragSourceResolver.getBlockInfoForHandle(handle),
                    isBlockInsideRenderedTableCell: (blockInfo) =>
                        isPosInsideRenderedTableCell(this.view, blockInfo.from, { skipLayoutRead: true }),
                    beginPointerDragSession: beginDragSession,
                    finishDragSession,
                    scheduleDropIndicatorUpdate: (clientX, clientY, dragSource) =>
                        this.dropIndicator.scheduleFromPoint(clientX, clientY, dragSource),
                    hideDropIndicator: () => this.dropIndicator.hide(),
                    performDropAtPoint: (sourceBlock, clientX, clientY) =>
                        this.performDropAtPoint(sourceBlock, clientX, clientY),
                });

                this.decorations = this.decorationManager.buildDecorations();
                this.dragEventHandler.attach();
                this.embedHandleManager.start();
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = this.decorationManager.buildDecorations();
                    this.embedHandleManager.scheduleScan();
                }
            }
            createHandleElement(getBlockInfo: () => BlockInfo | null): HTMLElement {
                const handle = createDragHandleElement({
                    onDragStart: (e, el) => startDragFromHandle(e, this.view, getBlockInfo, el),
                    onDragEnd: () => finishDragSession(),
                });
                handle.addEventListener('pointerdown', (e: PointerEvent) => {
                    this.dragEventHandler.startPointerDragFromHandle(handle, e, () => getBlockInfo());
                });
                return handle;
            }

            performDropAtPoint(sourceBlock: BlockInfo, clientX: number, clientY: number): void {
                const view = this.view;
                const targetInfo = this.dropTargetCalculator.getDropTargetInfo({
                    clientX,
                    clientY,
                    dragSource: sourceBlock,
                });
                const targetLineNumber = targetInfo?.lineNumber ?? null;
                const targetPos = targetLineNumber
                    ? (targetLineNumber > view.state.doc.lines
                        ? view.state.doc.length
                        : view.state.doc.line(targetLineNumber).from)
                    : view.posAtCoords({ x: clientX, y: clientY });

                if (targetPos === null) return;

                this.blockMover.moveBlock({
                    sourceBlock,
                    targetPos,
                    targetLineNumberOverride: targetLineNumber ?? undefined,
                    listContextLineNumberOverride: targetInfo?.listContextLineNumber,
                    listIndentDeltaOverride: targetInfo?.listIndentDelta,
                    listTargetIndentWidthOverride: targetInfo?.listTargetIndentWidth,
                });
            }

            destroy(): void {
                this.dragEventHandler.destroy();
                this.view.dom.classList.remove(ROOT_EDITOR_CLASS);
                this.view.contentDOM.classList.remove(MAIN_EDITOR_CONTENT_CLASS);
                this.embedHandleManager.destroy();
                this.dropIndicator.destroy();
            }
        },
        {
            decorations: (v) => v.decorations,
        }
    );
}

/**
 * 创建拖拽手柄编辑器扩展
 */
export function dragHandleExtension(plugin: DragNDropPlugin): Extension {
    return [createDragHandleViewPlugin(plugin)];
}
