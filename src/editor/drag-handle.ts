import { Extension } from '@codemirror/state';
import {
    EditorView,
    ViewPlugin,
    ViewUpdate,
    DecorationSet,
} from '@codemirror/view';
import { BlockInfo, DragLifecycleEvent, DragListIntent } from '../types';
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
import { createDragPerfSession, DragPerfSession, logDragPerfSession } from './core/perf-session';
import {
    getLineMap,
    primeLineMapFromTransition,
    setLineMapPerfRecorder,
} from './core/line-map';
import { setDetectBlockPerfRecorder, prewarmFenceScan } from './block-detector';
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
import { LineHandleManager } from './managers/LineHandleManager';
import { EmbedHandleManager } from './managers/EmbedHandleManager';
import { getLineNumberElementForLine, hasVisibleLineNumberGutter } from './core/handle-position';
import { clampNumber, clampTargetLineNumber } from './utils/coordinate-utils';
import {
    DOC_SEMANTIC_IDLE_SMALL_MS,
    DOC_SEMANTIC_IDLE_MEDIUM_MS,
    DOC_SEMANTIC_IDLE_LARGE_MS,
    HANDLE_INTERACTION_ZONE_PX,
    HOVER_HIDDEN_LINE_NUMBER_CLASS,
    GRAB_HIDDEN_LINE_NUMBER_CLASS,
} from './core/constants';

/**
 * 创建拖拽手柄ViewPlugin
 */
function createDragHandleViewPlugin(_plugin: DragNDropPlugin) {
    return ViewPlugin.fromClass(
        class {
            // decorations removed - now using LineHandleManager with independent DOM elements
            view: EditorView;
            dropIndicator: DropIndicatorManager;
            blockMover: BlockMover;
            dropTargetCalculator: DropTargetCalculator;
            lineParsingService: LineParsingService;
            geometryCalculator: GeometryCalculator;
            containerPolicyService: ContainerPolicyService;
            textMutationPolicy: TextMutationPolicy;
            lineHandleManager: LineHandleManager;
            embedHandleManager: EmbedHandleManager;
            dragEventHandler: DragEventHandler;
            dragSourceResolver: DragSourceResolver;
            private hiddenHoveredLineNumberEl: HTMLElement | null = null;
            private currentHoveredLineNumber: number | null = null;
            private readonly hiddenGrabbedLineNumberEls = new Set<HTMLElement>();
            private activeVisibleHandle: HTMLElement | null = null;
            private lastLifecycleSignature: string | null = null;
            private dragPerfSession: DragPerfSession | null = null;
            private lineMapPrewarmIdleHandle: number | null = null;
            private lineMapPrewarmTimerHandle: number | null = null;
            private pendingLineMapPrewarm: {
                previousState: any;
                nextState: any;
                changes: any;
                docLines: number;
            } | null = null;
            private semanticRefreshTimerHandle: number | null = null;
            private pendingSemanticRefresh = false;
            private viewportScrollContainer: HTMLElement | null = null;
            private viewportScrollRefreshTimerHandle: number | null = null;
            private viewportScrollRefreshRafHandle: number | null = null;
            private readonly onDocumentPointerMove = (e: PointerEvent) => this.handleDocumentPointerMove(e);
            private readonly onViewportScroll = () => this.scheduleViewportRefreshFromScroll();
            private readonly onSettingsUpdated = () => this.handleSettingsUpdated();

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
                    resolveDropRuleAtInsertion:
                        this.containerPolicyService.resolveDropRuleAtInsertion.bind(this.containerPolicyService),
                    getListContext: this.textMutationPolicy.getListContext.bind(this.textMutationPolicy),
                    getIndentUnitWidth: this.textMutationPolicy.getIndentUnitWidth.bind(this.textMutationPolicy),
                    getBlockInfoForEmbed: (embedEl) => this.dragSourceResolver.getBlockInfoForEmbed(embedEl),
                    getIndentUnitWidthForDoc: this.textMutationPolicy.getIndentUnitWidthForDoc.bind(this.textMutationPolicy),
                    getLineRect: this.geometryCalculator.getLineRect.bind(this.geometryCalculator),
                    getInsertionAnchorY: this.geometryCalculator.getInsertionAnchorY.bind(this.geometryCalculator),
                    getLineIndentPosByWidth: this.geometryCalculator.getLineIndentPosByWidth.bind(this.geometryCalculator),
                    getBlockRect: this.geometryCalculator.getBlockRect.bind(this.geometryCalculator),
                    clampNumber,
                    recordPerfDuration: (key, durationMs) => {
                        this.dragPerfSession?.recordDuration(key, durationMs);
                    },
                    incrementPerfCounter: (key, delta = 1) => {
                        this.dragPerfSession?.incrementCounter(key, delta);
                    },
                    onDragTargetEvaluated: ({ sourceBlock, pointerType, validation }) => {
                        if (!sourceBlock) return;
                        this.emitDragLifecycle({
                            state: 'drag_active',
                            sourceBlock,
                            targetLine: validation.targetLineNumber ?? null,
                            listIntent: this.buildListIntent({
                                listContextLineNumber: validation.listContextLineNumber,
                                listIndentDelta: validation.listIndentDelta,
                                listTargetIndentWidth: validation.listTargetIndentWidth,
                            }),
                            rejectReason: validation.allowed ? null : (validation.reason ?? null),
                            pointerType: pointerType ?? null,
                        });
                    },
                });
                this.dropIndicator = new DropIndicatorManager(view, (info) =>
                    this.dropTargetCalculator.getDropTargetInfo({
                        clientX: info.clientX,
                        clientY: info.clientY,
                        dragSource: info.dragSource ?? getActiveDragSourceBlock(this.view) ?? null,
                        pointerType: info.pointerType ?? null,
                    })
                    , {
                        recordPerfDuration: (key, durationMs) => {
                            this.dragPerfSession?.recordDuration(key, durationMs);
                        },
                        onFrameMetrics: (metrics) => {
                            if (!this.dragPerfSession) return;
                            this.dragPerfSession.incrementCounter('drop_indicator_frames');
                            if (metrics.skipped) {
                                this.dragPerfSession.incrementCounter('drop_indicator_skipped_frames');
                            }
                            if (metrics.reused) {
                                this.dragPerfSession.incrementCounter('drop_indicator_reused_frames');
                            }
                        },
                    }
                );
                this.blockMover = new BlockMover({
                    view: this.view,
                    clampTargetLineNumber,
                    getAdjustedTargetLocation: this.geometryCalculator.getAdjustedTargetLocation.bind(this.geometryCalculator),
                    resolveDropRuleAtInsertion:
                        this.containerPolicyService.resolveDropRuleAtInsertion.bind(this.containerPolicyService),
                    parseLineWithQuote: this.textMutationPolicy.parseLineWithQuote.bind(this.textMutationPolicy),
                    getListContext: this.textMutationPolicy.getListContext.bind(this.textMutationPolicy),
                    getIndentUnitWidth: this.textMutationPolicy.getIndentUnitWidth.bind(this.textMutationPolicy),
                    buildInsertText: this.textMutationPolicy.buildInsertText.bind(this.textMutationPolicy),
                });
                this.lineHandleManager = new LineHandleManager(this.view, {
                    createHandleElement: this.createHandleElement.bind(this),
                    getDraggableBlockAtLine: (lineNumber) => this.dragSourceResolver.getDraggableBlockAtLine(lineNumber),
                    shouldRenderLineHandles: () => true,
                });
                this.embedHandleManager = new EmbedHandleManager(this.view, {
                    createHandleElement: this.createHandleElement.bind(this),
                    resolveBlockInfoForEmbed: (embedEl) => this.dragSourceResolver.getBlockInfoForEmbed(embedEl),
                    shouldRenderEmbedHandles: () => true,
                });
                this.dragEventHandler = new DragEventHandler(this.view, {
                    getDragSourceBlock: (e) => getDragSourceBlockFromEvent(e, this.view),
                    getBlockInfoForHandle: (handle) =>
                        this.resolveInteractionBlockInfo({
                            handle,
                            clientX: Number.NaN,
                            clientY: Number.NaN,
                        }),
                    getBlockInfoAtPoint: (clientX, clientY) =>
                        this.resolveInteractionBlockInfo({
                            clientX,
                            clientY,
                        }),
                    isBlockInsideRenderedTableCell: (blockInfo) =>
                        isPosInsideRenderedTableCell(this.view, blockInfo.from, { skipLayoutRead: true }),
                    isMultiLineSelectionEnabled: () => _plugin.settings.enableMultiLineSelection,
                    beginPointerDragSession: (blockInfo) => {
                        this.ensureDragPerfSession();
                        const startLineNumber = blockInfo.startLine + 1;
                        const endLineNumber = blockInfo.endLine + 1;
                        this.enterGrabVisualState(startLineNumber, endLineNumber, null);
                        beginDragSession(blockInfo, this.view);
                    },
                    finishDragSession: () => {
                        this.clearGrabbedLineNumbers();
                        this.setActiveVisibleHandle(null);
                        finishDragSession(this.view);
                        this.flushDragPerfSession('finish_drag_session');
                    },
                    scheduleDropIndicatorUpdate: (clientX, clientY, dragSource, pointerType) =>
                        this.dropIndicator.scheduleFromPoint(clientX, clientY, dragSource, pointerType ?? null),
                    hideDropIndicator: () => this.dropIndicator.hide(),
                    performDropAtPoint: (sourceBlock, clientX, clientY, pointerType) =>
                        this.performDropAtPoint(sourceBlock, clientX, clientY, pointerType ?? null),
                    onDragLifecycleEvent: (event) => this.emitDragLifecycle(event),
                });

                this.lineHandleManager.start();
                this.dragEventHandler.attach();
                this.embedHandleManager.start();
                this.bindViewportScrollFallback();
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
                    // Still schedule line-map prewarm if doc changed
                    if (update.docChanged) {
                        this.scheduleLineMapPrewarm(update);
                    }
                    if (this.activeVisibleHandle && !this.activeVisibleHandle.isConnected) {
                        this.setActiveVisibleHandle(null);
                    }
                    return;
                }

                if (update.docChanged) {
                    // Mark semantic refresh pending - LineHandleManager will update on refresh
                    this.markSemanticRefreshPending();
                    this.scheduleLineMapPrewarm(update);
                } else if (update.geometryChanged) {
                    this.refreshDecorationsAndEmbeds();
                }

                if (update.docChanged || update.geometryChanged) {
                    this.dragEventHandler.refreshSelectionVisual();
                }
                if (this.activeVisibleHandle && !this.activeVisibleHandle.isConnected) {
                    this.setActiveVisibleHandle(null);
                }
            }

            createHandleElement(getBlockInfo: () => BlockInfo | null): HTMLElement {
                const handle = createDragHandleElement({
                    onDragStart: (e, el) => {
                        this.ensureSemanticReadyForInteraction();
                        const resolveCurrentBlock = () => this.resolveInteractionBlockInfo({
                            handle,
                            clientX: e.clientX,
                            clientY: e.clientY,
                            fallback: getBlockInfo,
                        });
                        const sourceBlock = resolveCurrentBlock();
                        if (sourceBlock) {
                            this.enterGrabVisualState(
                                sourceBlock.startLine + 1,
                                sourceBlock.endLine + 1,
                                el
                            );
                        } else {
                            this.setActiveVisibleHandle(el);
                        }
                        const started = startDragFromHandle(e, this.view, () => resolveCurrentBlock(), el);
                        if (!started) {
                            this.setActiveVisibleHandle(null);
                            finishDragSession(this.view);
                            this.flushDragPerfSession('drag_start_failed');
                            this.emitDragLifecycle({
                                state: 'cancelled',
                                sourceBlock: sourceBlock ?? null,
                                targetLine: null,
                                listIntent: null,
                                rejectReason: 'drag_start_failed',
                                pointerType: 'mouse',
                            });
                            this.emitDragLifecycle({
                                state: 'idle',
                                sourceBlock: null,
                                targetLine: null,
                                listIntent: null,
                                rejectReason: null,
                                pointerType: null,
                            });
                            return;
                        }
                        this.ensureDragPerfSession();
                        this.emitDragLifecycle({
                            state: 'drag_active',
                            sourceBlock: sourceBlock ?? null,
                            targetLine: null,
                            listIntent: null,
                            rejectReason: null,
                            pointerType: 'mouse',
                        });
                    },
                    onDragEnd: () => {
                        this.clearGrabbedLineNumbers();
                        this.setActiveVisibleHandle(null);
                        finishDragSession(this.view);
                        this.flushDragPerfSession('drag_end');
                        this.emitDragLifecycle({
                            state: 'idle',
                            sourceBlock: null,
                            targetLine: null,
                            listIntent: null,
                            rejectReason: null,
                            pointerType: null,
                        });
                    },
                });
                handle.addEventListener('pointerdown', (e: PointerEvent) => {
                    this.ensureSemanticReadyForInteraction();
                    const resolveCurrentBlock = () => this.resolveInteractionBlockInfo({
                        handle,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        fallback: getBlockInfo,
                    });
                    const shouldPrimePointerVisual = !(
                        e.pointerType === 'mouse'
                        && !_plugin.settings.enableMultiLineSelection
                    );
                    if (shouldPrimePointerVisual) {
                        const blockInfo = resolveCurrentBlock();
                        if (blockInfo) {
                            this.enterGrabVisualState(
                                blockInfo.startLine + 1,
                                blockInfo.endLine + 1,
                                handle
                            );
                        } else {
                            this.setActiveVisibleHandle(handle);
                        }
                    }
                    this.dragEventHandler.startPointerDragFromHandle(handle, e, () => resolveCurrentBlock());
                });
                return handle;
            }

            performDropAtPoint(sourceBlock: BlockInfo, clientX: number, clientY: number, pointerType: string | null): void {
                this.ensureDragPerfSession();
                const view = this.view;
                const validation = this.dropTargetCalculator.resolveValidatedDropTarget({
                    clientX,
                    clientY,
                    dragSource: sourceBlock,
                    pointerType,
                });
                if (!validation.allowed || typeof validation.targetLineNumber !== 'number') {
                    this.emitDragLifecycle({
                        state: 'cancelled',
                        sourceBlock,
                        targetLine: validation.targetLineNumber ?? null,
                        listIntent: this.buildListIntent({
                            listContextLineNumber: validation.listContextLineNumber,
                            listIndentDelta: validation.listIndentDelta,
                            listTargetIndentWidth: validation.listTargetIndentWidth,
                        }),
                        rejectReason: validation.reason ?? 'no_target',
                        pointerType,
                    });
                    return;
                }

                const targetLineNumber = validation.targetLineNumber;
                const targetPos = targetLineNumber > view.state.doc.lines
                    ? view.state.doc.length
                    : view.state.doc.line(targetLineNumber).from;

                this.blockMover.moveBlock({
                    sourceBlock,
                    targetPos,
                    targetLineNumberOverride: targetLineNumber,
                    listContextLineNumberOverride: validation.listContextLineNumber,
                    listIndentDeltaOverride: validation.listIndentDelta,
                    listTargetIndentWidthOverride: validation.listTargetIndentWidth,
                });
                this.emitDragLifecycle({
                    state: 'drop_commit',
                    sourceBlock,
                    targetLine: targetLineNumber,
                    listIntent: this.buildListIntent({
                        listContextLineNumber: validation.listContextLineNumber,
                        listIndentDelta: validation.listIndentDelta,
                        listTargetIndentWidth: validation.listTargetIndentWidth,
                    }),
                    rejectReason: null,
                    pointerType,
                });
            }

            destroy(): void {
                this.clearPendingLineMapPrewarm();
                this.clearPendingSemanticRefresh();
                this.unbindViewportScrollFallback();
                document.removeEventListener('pointermove', this.onDocumentPointerMove);
                window.removeEventListener('dnd:settings-updated', this.onSettingsUpdated);
                this.clearGrabbedLineNumbers();
                this.setActiveVisibleHandle(null);
                finishDragSession(this.view);
                this.flushDragPerfSession('destroy');
                this.dragEventHandler.destroy();
                this.lineHandleManager.destroy();
                this.view.dom.classList.remove(ROOT_EDITOR_CLASS);
                this.view.contentDOM.classList.remove(MAIN_EDITOR_CONTENT_CLASS);
                this.embedHandleManager.destroy();
                this.dropIndicator.destroy();
                this.emitDragLifecycle({
                    state: 'idle',
                    sourceBlock: null,
                    targetLine: null,
                    listIntent: null,
                    rejectReason: null,
                    pointerType: null,
                });
            }

            private handleDocumentPointerMove(e: PointerEvent): void {
                if (document.body.classList.contains('dnd-mobile-gesture-lock')) {
                    return;
                }
                if (document.body.classList.contains('dnd-dragging')) {
                    this.setActiveVisibleHandle(null, { preserveHoveredLineNumber: true });
                    return;
                }
                if (this.dragEventHandler.isGestureActive()) {
                    this.setActiveVisibleHandle(this.activeVisibleHandle, { preserveHoveredLineNumber: true });
                    return;
                }
                if (this.pendingSemanticRefresh && this.isPointerInHandleInteractionZone(e.clientX, e.clientY)) {
                    this.ensureSemanticReadyForInteraction();
                }

                const directHandle = this.resolveVisibleHandleFromTarget(e.target);
                if (directHandle) {
                    this.setActiveVisibleHandle(directHandle);
                    return;
                }

                // When line numbers are visible, keep the original behavior:
                // only show the hovered handle itself.
                if (hasVisibleLineNumberGutter(this.view)) {
                    this.setActiveVisibleHandle(null);
                    return;
                }

                // Without line numbers, hovering anywhere on the current line's right area
                // should reveal the left handle for that line.
                const handle = this.resolveVisibleHandleFromPointerWhenLineNumbersHidden(e.clientX, e.clientY);
                this.setActiveVisibleHandle(handle);
            }

            private clearHoveredLineNumber(): void {
                if (this.hiddenHoveredLineNumberEl) {
                    this.hiddenHoveredLineNumberEl.classList.remove(HOVER_HIDDEN_LINE_NUMBER_CLASS);
                }
                this.hiddenHoveredLineNumberEl = null;
                this.currentHoveredLineNumber = null;
            }

            private clearGrabbedLineNumbers(): void {
                for (const lineNumberEl of this.hiddenGrabbedLineNumberEls) {
                    lineNumberEl.classList.remove(GRAB_HIDDEN_LINE_NUMBER_CLASS);
                }
                this.hiddenGrabbedLineNumberEls.clear();
            }

            private setGrabbedLineNumberRange(startLineNumber: number, endLineNumber: number): void {
                this.clearGrabbedLineNumbers();
                if (!hasVisibleLineNumberGutter(this.view)) return;
                const safeStart = Math.max(1, Math.min(this.view.state.doc.lines, startLineNumber));
                const safeEnd = Math.max(1, Math.min(this.view.state.doc.lines, endLineNumber));
                const from = Math.min(safeStart, safeEnd);
                const to = Math.max(safeStart, safeEnd);
                for (let lineNumber = from; lineNumber <= to; lineNumber++) {
                    const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
                    if (!lineNumberEl) continue;
                    lineNumberEl.classList.add(GRAB_HIDDEN_LINE_NUMBER_CLASS);
                    this.hiddenGrabbedLineNumberEls.add(lineNumberEl);
                }
            }

            private setHoveredLineNumber(lineNumber: number): void {
                if (this.currentHoveredLineNumber === lineNumber && this.hiddenHoveredLineNumberEl) {
                    return;
                }
                const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
                if (!lineNumberEl) {
                    this.clearHoveredLineNumber();
                    return;
                }
                this.clearHoveredLineNumber();
                lineNumberEl.classList.add(HOVER_HIDDEN_LINE_NUMBER_CLASS);
                this.hiddenHoveredLineNumberEl = lineNumberEl;
                this.currentHoveredLineNumber = lineNumber;
            }

            private setActiveVisibleHandle(
                handle: HTMLElement | null,
                options?: { preserveHoveredLineNumber?: boolean }
            ): void {
                const preserveHoveredLineNumber = options?.preserveHoveredLineNumber === true;
                if (this.activeVisibleHandle === handle) {
                    if (!handle && !preserveHoveredLineNumber) {
                        this.clearHoveredLineNumber();
                    }
                    return;
                }
                if (this.activeVisibleHandle) {
                    this.activeVisibleHandle.classList.remove('is-visible');
                }

                this.activeVisibleHandle = handle;
                if (!handle) {
                    if (!preserveHoveredLineNumber) {
                        this.clearHoveredLineNumber();
                    }
                    return;
                }

                handle.classList.add('is-visible');
                if (!preserveHoveredLineNumber) {
                    const lineNumber = this.resolveHandleLineNumber(handle);
                    if (!lineNumber) {
                        this.clearHoveredLineNumber();
                        return;
                    }
                    this.setHoveredLineNumber(lineNumber);
                }
            }

            private enterGrabVisualState(
                startLineNumber: number,
                endLineNumber: number,
                handle: HTMLElement | null
            ): void {
                this.setActiveVisibleHandle(
                    handle,
                    { preserveHoveredLineNumber: true }
                );
                this.clearHoveredLineNumber();
                this.setGrabbedLineNumberRange(startLineNumber, endLineNumber);
            }

            private resolveHandleLineNumber(handle: HTMLElement): number | null {
                const startAttr = handle.getAttribute('data-block-start');
                if (startAttr !== null) {
                    const lineNumber = Number(startAttr) + 1;
                    if (Number.isInteger(lineNumber) && lineNumber >= 1 && lineNumber <= this.view.state.doc.lines) {
                        return lineNumber;
                    }
                }

                const blockInfo = this.dragSourceResolver.getBlockInfoForHandle(handle);
                if (!blockInfo) return null;
                const lineNumber = blockInfo.startLine + 1;
                if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > this.view.state.doc.lines) {
                    return null;
                }
                return lineNumber;
            }

            private buildListIntent(raw: {
                listContextLineNumber?: number;
                listIndentDelta?: number;
                listTargetIndentWidth?: number;
            }): DragListIntent | null {
                if (
                    typeof raw.listContextLineNumber !== 'number'
                    && typeof raw.listIndentDelta !== 'number'
                    && typeof raw.listTargetIndentWidth !== 'number'
                ) {
                    return null;
                }
                return {
                    listContextLineNumber: raw.listContextLineNumber,
                    listIndentDelta: raw.listIndentDelta,
                    listTargetIndentWidth: raw.listTargetIndentWidth,
                };
            }

            private emitDragLifecycle(event: DragLifecycleEvent): void {
                const payload: DragLifecycleEvent = {
                    state: event.state,
                    sourceBlock: event.sourceBlock ?? null,
                    targetLine: typeof event.targetLine === 'number' ? event.targetLine : null,
                    listIntent: event.listIntent ?? null,
                    rejectReason: event.rejectReason ?? null,
                    pointerType: event.pointerType ?? null,
                };
                const signature = JSON.stringify({
                    state: payload.state,
                    sourceStart: payload.sourceBlock?.startLine ?? null,
                    sourceEnd: payload.sourceBlock?.endLine ?? null,
                    targetLine: payload.targetLine,
                    listIntent: payload.listIntent,
                    rejectReason: payload.rejectReason,
                    pointerType: payload.pointerType,
                });
                if (signature === this.lastLifecycleSignature) return;
                this.lastLifecycleSignature = signature;
                _plugin.emitDragLifecycleEvent(payload);
            }

            private ensureDragPerfSession(): void {
                this.ensureSemanticReadyForInteraction();
                if (this.dragPerfSession) return;
                this.dragPerfSession = createDragPerfSession({
                    docLines: this.view.state.doc.lines,
                });
                setLineMapPerfRecorder((key, durationMs) => {
                    this.dragPerfSession?.recordDuration(key, durationMs);
                });
                setDetectBlockPerfRecorder((key, durationMs) => {
                    this.dragPerfSession?.recordDuration(key, durationMs);
                });
                // Warm line-map once per drag session to move cold build out of move-frame hot path.
                getLineMap(this.view.state);
            }

            private flushDragPerfSession(reason: string): void {
                if (this.dragPerfSession) {
                    logDragPerfSession(this.dragPerfSession, reason);
                    this.dragPerfSession = null;
                }
                setLineMapPerfRecorder(null);
                setDetectBlockPerfRecorder(null);
            }

            private scheduleLineMapPrewarm(update: ViewUpdate): void {
                const nextState = this.view.state as any;
                const docLines = nextState?.doc?.lines ?? 0;
                if (docLines > 30_000) {
                    // On very large docs, background prewarm can still cause visible typing hitches.
                    // We warm line-map lazily at drag start instead.
                    this.clearPendingLineMapPrewarm();
                    return;
                }
                this.pendingLineMapPrewarm = {
                    previousState: update.startState as any,
                    nextState,
                    changes: update.changes as any,
                    docLines,
                };
                if (this.lineMapPrewarmIdleHandle !== null) {
                    const cancelIdle = (window as any).cancelIdleCallback as
                        | ((id: number) => void)
                        | undefined;
                    if (typeof cancelIdle === 'function') {
                        cancelIdle(this.lineMapPrewarmIdleHandle);
                    }
                    this.lineMapPrewarmIdleHandle = null;
                }
                if (this.lineMapPrewarmTimerHandle !== null) {
                    window.clearTimeout(this.lineMapPrewarmTimerHandle);
                }

                const isLargeDoc = docLines > 30_000;
                const debounceMs = isLargeDoc ? 1200 : 250;
                this.lineMapPrewarmTimerHandle = window.setTimeout(() => {
                    this.lineMapPrewarmTimerHandle = null;
                    this.enqueueLineMapPrewarmIdleTask();
                }, debounceMs);
            }

            private enqueueLineMapPrewarmIdleTask(): void {
                const pending = this.pendingLineMapPrewarm;
                if (!pending) return;
                const run = () => {
                    this.lineMapPrewarmIdleHandle = null;
                    const latest = this.pendingLineMapPrewarm;
                    this.pendingLineMapPrewarm = null;
                    if (!latest) return;
                    try {
                        primeLineMapFromTransition({
                            previousState: latest.previousState,
                            nextState: latest.nextState,
                            changes: latest.changes,
                        });
                    } catch {
                        getLineMap(latest.nextState);
                    }
                };
                const requestIdle = (window as any).requestIdleCallback as
                    | ((cb: () => void, options?: { timeout?: number }) => number)
                    | undefined;
                if (typeof requestIdle === 'function') {
                    if (pending.docLines > 30_000) {
                        this.lineMapPrewarmIdleHandle = requestIdle(run);
                    } else {
                        this.lineMapPrewarmIdleHandle = requestIdle(run, { timeout: 200 });
                    }
                    return;
                }
                this.lineMapPrewarmTimerHandle = window.setTimeout(() => {
                    this.lineMapPrewarmTimerHandle = null;
                    run();
                }, pending.docLines > 30_000 ? 250 : 16);
            }

            private clearPendingLineMapPrewarm(): void {
                if (this.lineMapPrewarmIdleHandle !== null) {
                    const cancelIdle = (window as any).cancelIdleCallback as
                        | ((id: number) => void)
                        | undefined;
                    if (typeof cancelIdle === 'function') {
                        cancelIdle(this.lineMapPrewarmIdleHandle);
                    }
                    this.lineMapPrewarmIdleHandle = null;
                }
                if (this.lineMapPrewarmTimerHandle !== null) {
                    window.clearTimeout(this.lineMapPrewarmTimerHandle);
                    this.lineMapPrewarmTimerHandle = null;
                }
                this.pendingLineMapPrewarm = null;
            }

            private refreshDecorationsAndEmbeds(): void {
                this.clearPendingSemanticRefresh();
                this.lineHandleManager.scheduleScan({ urgent: true });
                this.embedHandleManager.scheduleScan({ urgent: true });
            }

            private bindViewportScrollFallback(): void {
                this.unbindViewportScrollFallback();
                const scroller = ((this.view as any).scrollDOM as HTMLElement | undefined)
                    ?? (this.view.dom.querySelector('.cm-scroller') as HTMLElement | null)
                    ?? null;
                if (!scroller) return;
                scroller.addEventListener('scroll', this.onViewportScroll, { passive: true });
                this.viewportScrollContainer = scroller;
            }

            private unbindViewportScrollFallback(): void {
                if (this.viewportScrollContainer) {
                    this.viewportScrollContainer.removeEventListener('scroll', this.onViewportScroll);
                    this.viewportScrollContainer = null;
                }
                this.clearScheduledViewportRefreshFromScroll();
            }

            private scheduleViewportRefreshFromScroll(): void {
                if (document.body.classList.contains('dnd-dragging')) return;
                if (this.dragEventHandler.isGestureActive()) return;
                // Skip if already scheduled - avoid redundant RAF calls during fast scrolling
                if (this.viewportScrollRefreshRafHandle !== null) return;

                this.viewportScrollRefreshRafHandle = window.requestAnimationFrame(() => {
                    this.viewportScrollRefreshRafHandle = null;
                    if (document.body.classList.contains('dnd-dragging')) return;
                    if (this.dragEventHandler.isGestureActive()) return;
                    this.refreshDecorationsAndEmbeds();
                    this.dragEventHandler.refreshSelectionVisual();
                });
            }

            private clearScheduledViewportRefreshFromScroll(): void {
                if (this.viewportScrollRefreshTimerHandle !== null) {
                    window.clearTimeout(this.viewportScrollRefreshTimerHandle);
                    this.viewportScrollRefreshTimerHandle = null;
                }
                if (this.viewportScrollRefreshRafHandle !== null) {
                    window.cancelAnimationFrame(this.viewportScrollRefreshRafHandle);
                    this.viewportScrollRefreshRafHandle = null;
                }
            }

            private markSemanticRefreshPending(): void {
                this.pendingSemanticRefresh = true;
                if (this.semanticRefreshTimerHandle !== null) {
                    window.clearTimeout(this.semanticRefreshTimerHandle);
                    this.semanticRefreshTimerHandle = null;
                }
                const delayMs = this.getSemanticRefreshDelayMs(this.view.state.doc.lines);
                this.semanticRefreshTimerHandle = window.setTimeout(() => {
                    this.semanticRefreshTimerHandle = null;
                    if (document.body.classList.contains('dnd-dragging')) {
                        this.markSemanticRefreshPending();
                        return;
                    }
                    if (!this.pendingSemanticRefresh) return;
                    this.refreshDecorationsAndEmbeds();
                }, delayMs);
            }

            private ensureSemanticReadyForInteraction(): void {
                const hasPendingViewportRefresh = this.viewportScrollRefreshTimerHandle !== null
                    || this.viewportScrollRefreshRafHandle !== null;
                if (!this.pendingSemanticRefresh && !hasPendingViewportRefresh) return;
                this.clearScheduledViewportRefreshFromScroll();
                this.refreshDecorationsAndEmbeds();
            }

            private clearPendingSemanticRefresh(): void {
                this.pendingSemanticRefresh = false;
                if (this.semanticRefreshTimerHandle !== null) {
                    window.clearTimeout(this.semanticRefreshTimerHandle);
                    this.semanticRefreshTimerHandle = null;
                }
            }

            private handleSettingsUpdated(): void {
                this.refreshDecorationsAndEmbeds();
                this.dragEventHandler.refreshSelectionVisual();
            }

            private getSemanticRefreshDelayMs(docLines: number): number {
                if (docLines > 120_000) return DOC_SEMANTIC_IDLE_LARGE_MS;
                if (docLines > 30_000) return DOC_SEMANTIC_IDLE_MEDIUM_MS;
                return DOC_SEMANTIC_IDLE_SMALL_MS;
            }

            private isPointerInHandleInteractionZone(clientX: number, clientY: number): boolean {
                const contentRect = this.view.contentDOM.getBoundingClientRect();
                if (clientY < contentRect.top || clientY > contentRect.bottom) return false;
                const leftBound = contentRect.left - HANDLE_INTERACTION_ZONE_PX;
                const rightBound = contentRect.left + HANDLE_INTERACTION_ZONE_PX;
                return clientX >= leftBound && clientX <= rightBound;
            }

            private resolveVisibleHandleFromTarget(target: EventTarget | null): HTMLElement | null {
                if (!(target instanceof HTMLElement)) return null;

                const directHandle = target.closest('.dnd-drag-handle') as HTMLElement | null;
                if (!directHandle) return null;
                if (this.view.dom.contains(directHandle) || this.embedHandleManager.isManagedHandle(directHandle)) {
                    return directHandle;
                }
                return null;
            }

            private resolveVisibleHandleFromPointerWhenLineNumbersHidden(clientX: number, clientY: number): HTMLElement | null {
                const contentRect = this.view.contentDOM.getBoundingClientRect();
                if (
                    clientX < contentRect.left
                    || clientX > contentRect.right
                    || clientY < contentRect.top
                    || clientY > contentRect.bottom
                ) {
                    return null;
                }

                const blockInfo = this.dragSourceResolver.getDraggableBlockAtPoint(clientX, clientY);
                if (!blockInfo) return null;
                return this.resolveVisibleHandleForBlock(blockInfo);
            }

            private resolveVisibleHandleForBlock(blockInfo: BlockInfo): HTMLElement | null {
                const selector = `.dnd-drag-handle[data-block-start="${blockInfo.startLine}"]`;
                const candidates = Array.from(this.view.dom.querySelectorAll(selector)) as HTMLElement[];
                if (candidates.length === 0) return null;

                const inlineHandle = candidates.find((handle) => !handle.classList.contains('dnd-embed-handle'));
                if (inlineHandle) return inlineHandle;

                return candidates.find((handle) => this.embedHandleManager.isManagedHandle(handle)) ?? null;
            }

            private resolveInteractionBlockInfo(params: {
                handle?: HTMLElement | null;
                clientX: number;
                clientY: number;
                fallback?: () => BlockInfo | null;
                allowRefreshRetry?: boolean;
            }): BlockInfo | null {
                const allowRefreshRetry = params.allowRefreshRetry !== false;
                const resolveOnce = (): BlockInfo | null => {
                    if (params.handle) {
                        let fromHandle: BlockInfo | null = null;
                        try {
                            fromHandle = this.dragSourceResolver.getBlockInfoForHandle(params.handle);
                        } catch {
                            fromHandle = null;
                        }
                        if (fromHandle) {
                            this.syncHandleBlockAttributes(params.handle, fromHandle);
                            return fromHandle;
                        }
                    }

                    if (Number.isFinite(params.clientX) && Number.isFinite(params.clientY)) {
                        let fromPoint: BlockInfo | null = null;
                        try {
                            fromPoint = this.dragSourceResolver.getDraggableBlockAtPoint(params.clientX, params.clientY);
                        } catch {
                            fromPoint = null;
                        }
                        if (fromPoint) {
                            this.syncHandleBlockAttributes(params.handle ?? null, fromPoint);
                            return fromPoint;
                        }
                    }

                    const fromFallback = params.fallback?.() ?? null;
                    if (fromFallback) {
                        this.syncHandleBlockAttributes(params.handle ?? null, fromFallback);
                    }
                    return fromFallback;
                };

                const first = resolveOnce();
                if (first || !allowRefreshRetry) return first;

                // Refresh decorations and retry - use coordinates since handle may be stale
                this.refreshDecorationsAndEmbeds();

                if (Number.isFinite(params.clientX) && Number.isFinite(params.clientY)) {
                    try {
                        const fromPoint = this.dragSourceResolver.getDraggableBlockAtPoint(params.clientX, params.clientY);
                        if (fromPoint) {
                            this.syncHandleBlockAttributes(params.handle ?? null, fromPoint);
                            return fromPoint;
                        }
                    } catch {
                        // fall through
                    }
                }

                return params.fallback?.() ?? null;
            }

            private syncHandleBlockAttributes(handle: HTMLElement | null, blockInfo: BlockInfo): void {
                if (!handle || !handle.isConnected) return;
                handle.setAttribute('data-block-start', String(blockInfo.startLine));
                handle.setAttribute('data-block-end', String(blockInfo.endLine));
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
