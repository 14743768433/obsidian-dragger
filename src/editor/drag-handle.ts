import { Extension } from '@codemirror/state';
import {
    EditorView,
    ViewPlugin,
    ViewUpdate,
} from '@codemirror/view';
import DragNDropPlugin from '../main';
import {
    ROOT_EDITOR_CLASS,
    MAIN_EDITOR_CONTENT_CLASS,
    MOBILE_GESTURE_LOCK_CLASS,
    DRAGGING_BODY_CLASS,
} from './core/selectors';
import {
    getActiveDragSourceBlock,
} from './core/session';
import {
    isPosInsideRenderedTableCell,
} from './core/table-guard';
import { prewarmFenceScan } from './core/block-detector';
import { BlockMover } from './movers/BlockMover';
import { DropIndicatorManager } from './visual/DropIndicatorManager';
import { DropTargetCalculator } from './drop-target/DropTargetCalculator';
import { DragEventHandler } from './interaction/DragEventHandler';
import {
    beginDragSession,
    finishDragSession,
    getDragSourceBlockFromEvent,
} from './interaction/DragTransfer';
import { BlockInfo } from '../types';
import { LineHandleManager } from './visual/LineHandleManager';
import { EmbedHandleManager } from './visual/EmbedHandleManager';
import { HandleVisibilityController } from './visual/HandleVisibilityController';
import { SemanticRefreshScheduler } from './orchestration/SemanticRefreshScheduler';
import { LineMapPrewarmer } from './orchestration/LineMapPrewarmer';
import { DragPerfSessionManager } from './orchestration/DragPerfSessionManager';
import { ServiceContainer } from './core/services/ServiceContainer';
import { hasVisibleLineNumberGutter } from './core/handle-position';
import {
    DragLifecycleEmitter,
} from './core/DragLifecycleEmitter';
import { HandleInteractionOrchestrator } from './orchestration/HandleInteractionOrchestrator';

/**
 * 创建拖拽手柄ViewPlugin
 */
function createDragHandleViewPlugin(_plugin: DragNDropPlugin) {
    return ViewPlugin.fromClass(
        class {
            // decorations removed - now using LineHandleManager with independent DOM elements
            private readonly view: EditorView;
            private readonly services: ServiceContainer;
            private readonly dropIndicator: DropIndicatorManager;
            private readonly blockMover: BlockMover;
            private readonly dropTargetCalculator: DropTargetCalculator;
            private readonly lineHandleManager: LineHandleManager;
            private readonly embedHandleManager: EmbedHandleManager;
            private readonly dragEventHandler: DragEventHandler;
            private readonly handleVisibility: HandleVisibilityController;
            private readonly orchestrator: HandleInteractionOrchestrator;
            private readonly lifecycleEmitter = new DragLifecycleEmitter(
                (event) => _plugin.emitDragLifecycleEvent(event)
            );
            private readonly lineMapPrewarmer = new LineMapPrewarmer();
            private readonly dragPerfManager: DragPerfSessionManager;
            private readonly semanticRefreshScheduler: SemanticRefreshScheduler;
            private readonly onDocumentPointerMove = (e: PointerEvent) => this.handleDocumentPointerMove(e);
            private readonly onSettingsUpdated = () => this.handleSettingsUpdated();

            constructor(view: EditorView) {
                this.view = view;
                this.view.dom.classList.add(ROOT_EDITOR_CLASS);
                this.view.contentDOM.classList.add(MAIN_EDITOR_CONTENT_CLASS);
                this.syncGutterClass();
                this.services = new ServiceContainer(this.view);
                this.handleVisibility = new HandleVisibilityController(this.view, {
                    getBlockInfoForHandle: (handle) => this.services.dragSource.getBlockInfoForHandle(handle),
                    getDraggableBlockAtPoint: (clientX, clientY) => this.services.dragSource.getDraggableBlockAtPoint(clientX, clientY),
                    isManagedEmbedHandle: (handle) => this.embedHandleManager?.isManagedHandle(handle) ?? false,
                });
                this.dragPerfManager = new DragPerfSessionManager(this.view);
                this.dropTargetCalculator = new DropTargetCalculator(this.view,
                    this.services.buildDropTargetCalculatorDeps({
                        recordPerfDuration: (key, durationMs) => {
                            this.dragPerfManager.recordDuration(key, durationMs);
                        },
                        incrementPerfCounter: (key, delta = 1) => {
                            this.dragPerfManager.incrementCounter(key, delta);
                        },
                        onDragTargetEvaluated: ({ sourceBlock, pointerType, validation }) => {
                            if (!sourceBlock) return;
                            this.orchestrator.emitDragLifecycle({
                                state: 'drag_active',
                                sourceBlock,
                                targetLine: validation.targetLineNumber ?? null,
                                listIntent: this.orchestrator.buildListIntentFromValidation(validation),
                                rejectReason: validation.allowed ? null : (validation.reason ?? null),
                                pointerType: pointerType ?? null,
                            });
                        },
                    }),
                );
                this.dropIndicator = new DropIndicatorManager(view, (info) =>
                    this.dropTargetCalculator.getDropTargetInfo({
                        clientX: info.clientX,
                        clientY: info.clientY,
                        dragSource: info.dragSource ?? getActiveDragSourceBlock(this.view) ?? null,
                        pointerType: info.pointerType ?? null,
                    })
                    , {
                        recordPerfDuration: (key, durationMs) => {
                            this.dragPerfManager.recordDuration(key, durationMs);
                        },
                        onFrameMetrics: (metrics) => {
                            this.dragPerfManager.incrementCounter('drop_indicator_frames');
                            if (metrics.skipped) {
                                this.dragPerfManager.incrementCounter('drop_indicator_skipped_frames');
                            }
                            if (metrics.reused) {
                                this.dragPerfManager.incrementCounter('drop_indicator_reused_frames');
                            }
                        },
                    }
                );
                this.blockMover = new BlockMover({
                    view: this.view,
                    ...this.services.buildBlockMoverDeps(),
                });
                this.orchestrator = new HandleInteractionOrchestrator({
                    view: this.view,
                    services: this.services,
                    blockMover: this.blockMover,
                    dropTargetCalculator: this.dropTargetCalculator,
                    handleVisibility: this.handleVisibility,
                    dragPerfManager: this.dragPerfManager,
                    lifecycleEmitter: this.lifecycleEmitter,
                    getSemanticRefreshScheduler: () => this.semanticRefreshScheduler,
                    refreshDecorationsAndEmbeds: () => this.refreshDecorationsAndEmbeds(),
                    isMultiLineSelectionEnabled: () => _plugin.settings.enableMultiLineSelection,
                    getDragEventHandler: () => this.dragEventHandler,
                });
                this.lineHandleManager = new LineHandleManager(this.view, {
                    createHandleElement: (getBlockInfo) => this.orchestrator.createHandleElement(getBlockInfo),
                    getDraggableBlockAtLine: (lineNumber) => this.services.dragSource.getDraggableBlockAtLine(lineNumber),
                    shouldRenderLineHandles: () => true,
                });
                this.embedHandleManager = new EmbedHandleManager(this.view, {
                    createHandleElement: (getBlockInfo) => this.orchestrator.createHandleElement(getBlockInfo),
                    resolveBlockInfoForEmbed: (embedEl) => this.services.dragSource.getBlockInfoForEmbed(embedEl),
                    shouldRenderEmbedHandles: () => true,
                });
                this.dragEventHandler = new DragEventHandler(this.view, {
                    getDragSourceBlock: (e) => getDragSourceBlockFromEvent(e, this.view),
                    getBlockInfoForHandle: (handle) =>
                        this.orchestrator.resolveInteractionBlockInfo({
                            handle,
                            clientX: Number.NaN,
                            clientY: Number.NaN,
                        }),
                    getBlockInfoAtPoint: (clientX, clientY) =>
                        this.orchestrator.resolveInteractionBlockInfo({
                            clientX,
                            clientY,
                        }),
                    isBlockInsideRenderedTableCell: (blockInfo) =>
                        isPosInsideRenderedTableCell(this.view, blockInfo.from, { skipLayoutRead: true }),
                    isMultiLineSelectionEnabled: () => _plugin.settings.enableMultiLineSelection,
                    beginPointerDragSession: (blockInfo) => {
                        this.orchestrator.ensureDragPerfSession();
                        const startLineNumber = blockInfo.startLine + 1;
                        const endLineNumber = blockInfo.endLine + 1;
                        this.handleVisibility.enterGrabVisualState(startLineNumber, endLineNumber, null);
                        beginDragSession(blockInfo, this.view);
                    },
                    finishDragSession: () => {
                        this.handleVisibility.clearGrabbedLineNumbers();
                        this.handleVisibility.setActiveVisibleHandle(null);
                        finishDragSession(this.view);
                        this.orchestrator.flushDragPerfSession('finish_drag_session');
                        this.refreshDecorationsAndEmbeds();
                    },
                    scheduleDropIndicatorUpdate: (clientX, clientY, dragSource, pointerType) =>
                        this.dropIndicator.scheduleFromPoint(clientX, clientY, dragSource, pointerType ?? null),
                    hideDropIndicator: () => this.dropIndicator.hide(),
                    performDropAtPoint: (sourceBlock, clientX, clientY, pointerType) =>
                        this.orchestrator.performDropAtPoint(sourceBlock, clientX, clientY, pointerType ?? null),
                    onDragLifecycleEvent: (event) => this.orchestrator.emitDragLifecycle(event),
                });

                this.semanticRefreshScheduler = new SemanticRefreshScheduler(this.view, {
                    performRefresh: () => this.refreshDecorationsAndEmbeds(),
                    isGestureActive: () => this.dragEventHandler.isGestureActive(),
                    refreshSelectionVisual: () => this.dragEventHandler.refreshSelectionVisual(),
                });

                this.lineHandleManager.start();
                this.dragEventHandler.attach();
                this.embedHandleManager.start();
                this.semanticRefreshScheduler.bindViewportScrollFallback();
                document.addEventListener('pointermove', this.onDocumentPointerMove, { passive: true });
                window.addEventListener('dnd:settings-updated', this.onSettingsUpdated);

                // Pre-warm fence scan during idle to ensure code/math block boundaries are ready
                const warmupFenceScan = () => prewarmFenceScan(view.state.doc);
                const requestIdle = (window as any).requestIdleCallback as
                    | ((cb: () => void, options?: { timeout?: number }) => number)
                    | undefined;
                if (typeof requestIdle === 'function') {
                    requestIdle(warmupFenceScan, { timeout: 1000 });
                } else {
                    window.setTimeout(warmupFenceScan, 100);
                }
            }

            update(update: ViewUpdate) {
                // Viewport changes have highest priority - refresh visible decorations immediately
                if (update.viewportChanged) {
                    this.refreshDecorationsAndEmbeds();
                    this.dragEventHandler.refreshSelectionVisual();
                    // Deferred rescan to catch layout shifts after viewport/file switch
                    this.lineHandleManager.scheduleScan();
                    // Still schedule line-map prewarm if doc changed
                    if (update.docChanged) {
                        this.lineMapPrewarmer.schedule(update);
                    }
                    const activeHandle = this.handleVisibility.getActiveHandle();
                    if (activeHandle && !activeHandle.isConnected) {
                        this.handleVisibility.setActiveVisibleHandle(null);
                    }
                    return;
                }

                if (update.docChanged) {
                    // Mark semantic refresh pending - LineHandleManager will update on refresh
                    this.semanticRefreshScheduler.markSemanticRefreshPending();
                    this.lineMapPrewarmer.schedule(update);
                } else if (update.geometryChanged) {
                    this.refreshDecorationsAndEmbeds();
                }

                if (update.docChanged || update.geometryChanged) {
                    this.dragEventHandler.refreshSelectionVisual();
                }
                const activeHandle2 = this.handleVisibility.getActiveHandle();
                if (activeHandle2 && !activeHandle2.isConnected) {
                    this.handleVisibility.setActiveVisibleHandle(null);
                }
            }

            destroy(): void {
                this.lineMapPrewarmer.clear();
                this.semanticRefreshScheduler.destroy();
                document.removeEventListener('pointermove', this.onDocumentPointerMove);
                window.removeEventListener('dnd:settings-updated', this.onSettingsUpdated);
                this.handleVisibility.clearGrabbedLineNumbers();
                this.handleVisibility.setActiveVisibleHandle(null);
                finishDragSession(this.view);
                this.orchestrator.flushDragPerfSession('destroy');
                this.dragEventHandler.destroy();
                this.lineHandleManager.destroy();
                this.view.dom.classList.remove(ROOT_EDITOR_CLASS);
                this.view.contentDOM.classList.remove(MAIN_EDITOR_CONTENT_CLASS);
                this.embedHandleManager.destroy();
                this.dropIndicator.destroy();
                this.orchestrator.emitDragLifecycle({
                    state: 'idle',
                    sourceBlock: null,
                    targetLine: null,
                    listIntent: null,
                    rejectReason: null,
                    pointerType: null,
                });
            }

            private handleDocumentPointerMove(e: PointerEvent): void {
                if (document.body.classList.contains(MOBILE_GESTURE_LOCK_CLASS)) {
                    return;
                }
                if (document.body.classList.contains(DRAGGING_BODY_CLASS)) {
                    this.handleVisibility.setActiveVisibleHandle(null, { preserveHoveredLineNumber: true });
                    return;
                }
                if (this.dragEventHandler.isGestureActive()) {
                    this.handleVisibility.setActiveVisibleHandle(this.handleVisibility.getActiveHandle(), { preserveHoveredLineNumber: true });
                    return;
                }
                if (this.semanticRefreshScheduler.isPending && this.handleVisibility.isPointerInHandleInteractionZone(e.clientX, e.clientY)) {
                    this.semanticRefreshScheduler.ensureSemanticReadyForInteraction();
                }

                const directHandle = this.handleVisibility.resolveVisibleHandleFromTarget(e.target);
                if (directHandle) {
                    this.handleVisibility.setActiveVisibleHandle(directHandle);
                    return;
                }

                // When line numbers are visible, keep the original behavior:
                // only show the hovered handle itself.
                if (hasVisibleLineNumberGutter(this.view)) {
                    this.handleVisibility.setActiveVisibleHandle(null);
                    return;
                }

                // Without line numbers, hovering anywhere on the current line's right area
                // should reveal the left handle for that line.
                const handle = this.handleVisibility.resolveVisibleHandleFromPointerWhenLineNumbersHidden(e.clientX, e.clientY);
                this.handleVisibility.setActiveVisibleHandle(handle);
            }

            private syncGutterClass(): void {
                const hasGutter = hasVisibleLineNumberGutter(this.view);
                this.view.dom.classList.toggle('dnd-no-gutter', !hasGutter);
            }

            private refreshDecorationsAndEmbeds(): void {
                this.syncGutterClass();
                this.semanticRefreshScheduler.clearPendingSemanticRefresh();
                this.lineHandleManager.scheduleScan({ urgent: true });
                this.embedHandleManager.scheduleScan({ urgent: true });
            }

            private handleSettingsUpdated(): void {
                this.refreshDecorationsAndEmbeds();
                this.dragEventHandler.refreshSelectionVisual();
            }
        }
        // No decorations config - LineHandleManager uses independent DOM elements
    );
}

/**
 * 创建拖拽手柄编辑器扩展
 */
export function dragHandleExtension(plugin: DragNDropPlugin): Extension {
    return [createDragHandleViewPlugin(plugin)];
}
