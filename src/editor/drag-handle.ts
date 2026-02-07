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
import { getPreviousNonEmptyLineNumber as getPreviousNonEmptyLineNumberInDoc } from './core/container-policies';
import { BlockMover } from './movers/BlockMover';
import { DropIndicatorManager } from './managers/DropIndicatorManager';
import { DropTargetCalculator } from './handlers/DropTargetCalculator';
import { DragEventHandler } from './handlers/DragEventHandler';
import { DragSourceResolver } from './handlers/DragSourceResolver';
import { LineParsingService } from './handlers/LineParsingService';
import { GeometryCalculator } from './handlers/GeometryCalculator';
import { ContainerPolicyService } from './handlers/ContainerPolicyService';
import { TextMutationPolicy } from './handlers/TextMutationPolicy';
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
            lineParsingService: LineParsingService;
            geometryCalculator: GeometryCalculator;
            containerPolicyService: ContainerPolicyService;
            textMutationPolicy: TextMutationPolicy;
            decorationManager: DecorationManager;
            embedHandleManager: EmbedHandleManager;
            dragEventHandler: DragEventHandler;
            dragSourceResolver: DragSourceResolver;

            constructor(view: EditorView) {
                this.view = view;
                this.view.dom.classList.add(ROOT_EDITOR_CLASS);
                this.view.contentDOM.classList.add(MAIN_EDITOR_CONTENT_CLASS);
                this.dragSourceResolver = new DragSourceResolver(this.view);
                this.lineParsingService = new LineParsingService(this.view);
                this.geometryCalculator = new GeometryCalculator(this.view, this.lineParsingService);
                this.containerPolicyService = new ContainerPolicyService(this.view);
                this.textMutationPolicy = new TextMutationPolicy(this.lineParsingService);
                this.dropTargetCalculator = new DropTargetCalculator(this.view, {
                    parseLineWithQuote: this.textMutationPolicy.parseLineWithQuote.bind(this.textMutationPolicy),
                    getAdjustedTargetLocation: this.geometryCalculator.getAdjustedTargetLocation.bind(this.geometryCalculator),
                    clampTargetLineNumber,
                    getPreviousNonEmptyLineNumber: getPreviousNonEmptyLineNumberInDoc,
                    shouldPreventDropIntoDifferentContainer:
                        this.containerPolicyService.shouldPreventDropIntoDifferentContainer.bind(this.containerPolicyService),
                    getBlockInfoForEmbed: (embedEl) => this.dragSourceResolver.getBlockInfoForEmbed(embedEl),
                    getIndentUnitWidthForDoc: this.textMutationPolicy.getIndentUnitWidthForDoc.bind(this.textMutationPolicy),
                    getLineRect: this.geometryCalculator.getLineRect.bind(this.geometryCalculator),
                    getInsertionAnchorY: this.geometryCalculator.getInsertionAnchorY.bind(this.geometryCalculator),
                    getLineIndentPosByWidth: this.geometryCalculator.getLineIndentPosByWidth.bind(this.geometryCalculator),
                    getBlockRect: this.geometryCalculator.getBlockRect.bind(this.geometryCalculator),
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
                    getAdjustedTargetLocation: this.geometryCalculator.getAdjustedTargetLocation.bind(this.geometryCalculator),
                    shouldPreventDropIntoDifferentContainer:
                        this.containerPolicyService.shouldPreventDropIntoDifferentContainer.bind(this.containerPolicyService),
                    parseLineWithQuote: this.textMutationPolicy.parseLineWithQuote.bind(this.textMutationPolicy),
                    getListContext: this.textMutationPolicy.getListContext.bind(this.textMutationPolicy),
                    getIndentUnitWidth: this.textMutationPolicy.getIndentUnitWidth.bind(this.textMutationPolicy),
                    buildInsertText: this.textMutationPolicy.buildInsertText.bind(this.textMutationPolicy),
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
