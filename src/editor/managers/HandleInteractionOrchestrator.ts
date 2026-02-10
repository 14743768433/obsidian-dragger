import { EditorView } from '@codemirror/view';
import { BlockInfo, DragLifecycleEvent, DragListIntent } from '../../types';
import { createDragHandleElement } from '../core/handle-dom';
import {
    beginDragSession,
    finishDragSession,
    startDragFromHandle,
} from '../handlers/DragTransfer';
import { buildListIntent, DragLifecycleEmitter } from '../core/DragLifecycleEmitter';
import { ServiceContainer } from '../core/ServiceContainer';
import { BlockMover } from '../movers/BlockMover';
import { DropTargetCalculator } from '../handlers/DropTargetCalculator';
import { HandleVisibilityController } from './HandleVisibilityController';
import { DragPerfSessionManager } from './DragPerfSessionManager';
import { SemanticRefreshScheduler } from './SemanticRefreshScheduler';
import { DragEventHandler } from '../handlers/DragEventHandler';

export interface HandleInteractionOrchestratorDeps {
    view: EditorView;
    services: ServiceContainer;
    blockMover: BlockMover;
    dropTargetCalculator: DropTargetCalculator;
    handleVisibility: HandleVisibilityController;
    dragPerfManager: DragPerfSessionManager;
    lifecycleEmitter: DragLifecycleEmitter;
    getSemanticRefreshScheduler: () => SemanticRefreshScheduler;
    refreshDecorationsAndEmbeds: () => void;
    isMultiLineSelectionEnabled: () => boolean;
    getDragEventHandler: () => DragEventHandler;
}

export class HandleInteractionOrchestrator {
    private readonly view: EditorView;
    private readonly services: ServiceContainer;
    private readonly blockMover: BlockMover;
    private readonly dropTargetCalculator: DropTargetCalculator;
    private readonly handleVisibility: HandleVisibilityController;
    private readonly dragPerfManager: DragPerfSessionManager;
    private readonly lifecycleEmitter: DragLifecycleEmitter;
    private readonly getSemanticRefreshScheduler: () => SemanticRefreshScheduler;
    private readonly refreshDecorationsAndEmbeds: () => void;
    private readonly isMultiLineSelectionEnabled: () => boolean;
    private readonly getDragEventHandler: () => DragEventHandler;

    constructor(deps: HandleInteractionOrchestratorDeps) {
        this.view = deps.view;
        this.services = deps.services;
        this.blockMover = deps.blockMover;
        this.dropTargetCalculator = deps.dropTargetCalculator;
        this.handleVisibility = deps.handleVisibility;
        this.dragPerfManager = deps.dragPerfManager;
        this.lifecycleEmitter = deps.lifecycleEmitter;
        this.getSemanticRefreshScheduler = deps.getSemanticRefreshScheduler;
        this.refreshDecorationsAndEmbeds = deps.refreshDecorationsAndEmbeds;
        this.isMultiLineSelectionEnabled = deps.isMultiLineSelectionEnabled;
        this.getDragEventHandler = deps.getDragEventHandler;
    }

    createHandleElement(getBlockInfo: () => BlockInfo | null): HTMLElement {
        const handle = createDragHandleElement({
            onDragStart: (e, el) => {
                this.getSemanticRefreshScheduler().ensureSemanticReadyForInteraction();
                const resolveCurrentBlock = () => this.resolveInteractionBlockInfo({
                    handle,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    fallback: getBlockInfo,
                });
                const sourceBlock = resolveCurrentBlock();
                if (sourceBlock) {
                    this.handleVisibility.enterGrabVisualState(
                        sourceBlock.startLine + 1,
                        sourceBlock.endLine + 1,
                        el
                    );
                } else {
                    this.handleVisibility.setActiveVisibleHandle(el);
                }
                const started = startDragFromHandle(e, this.view, () => resolveCurrentBlock(), el);
                if (!started) {
                    this.handleVisibility.setActiveVisibleHandle(null);
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
                this.handleVisibility.clearGrabbedLineNumbers();
                this.handleVisibility.setActiveVisibleHandle(null);
                finishDragSession(this.view);
                this.flushDragPerfSession('drag_end');
                this.refreshDecorationsAndEmbeds();
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
            this.getSemanticRefreshScheduler().ensureSemanticReadyForInteraction();
            const resolveCurrentBlock = () => this.resolveInteractionBlockInfo({
                handle,
                clientX: e.clientX,
                clientY: e.clientY,
                fallback: getBlockInfo,
            });
            const shouldPrimePointerVisual = !(
                e.pointerType === 'mouse'
                && !this.isMultiLineSelectionEnabled()
            );
            if (shouldPrimePointerVisual) {
                const blockInfo = resolveCurrentBlock();
                if (blockInfo) {
                    this.handleVisibility.enterGrabVisualState(
                        blockInfo.startLine + 1,
                        blockInfo.endLine + 1,
                        handle
                    );
                } else {
                    this.handleVisibility.setActiveVisibleHandle(handle);
                }
            }
            this.getDragEventHandler().startPointerDragFromHandle(handle, e, () => resolveCurrentBlock());
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
                listIntent: buildListIntent({
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
            listIntent: buildListIntent({
                listContextLineNumber: validation.listContextLineNumber,
                listIndentDelta: validation.listIndentDelta,
                listTargetIndentWidth: validation.listTargetIndentWidth,
            }),
            rejectReason: null,
            pointerType,
        });
    }

    resolveInteractionBlockInfo(params: {
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
                    fromHandle = this.services.dragSource.getBlockInfoForHandle(params.handle);
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
                    fromPoint = this.services.dragSource.getDraggableBlockAtPoint(params.clientX, params.clientY);
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
                const fromPoint = this.services.dragSource.getDraggableBlockAtPoint(params.clientX, params.clientY);
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

    ensureDragPerfSession(): void {
        this.getSemanticRefreshScheduler().ensureSemanticReadyForInteraction();
        this.dragPerfManager.ensure();
    }

    flushDragPerfSession(reason: string): void {
        this.dragPerfManager.flush(reason);
    }

    emitDragLifecycle(event: DragLifecycleEvent): void {
        this.lifecycleEmitter.emit(event);
    }

    buildListIntentFromValidation(validation: {
        listContextLineNumber?: number;
        listIndentDelta?: number;
        listTargetIndentWidth?: number;
    }): DragListIntent | null {
        return buildListIntent({
            listContextLineNumber: validation.listContextLineNumber,
            listIndentDelta: validation.listIndentDelta,
            listTargetIndentWidth: validation.listTargetIndentWidth,
        });
    }

    private syncHandleBlockAttributes(handle: HTMLElement | null, blockInfo: BlockInfo): void {
        if (!handle || !handle.isConnected) return;
        handle.setAttribute('data-block-start', String(blockInfo.startLine));
        handle.setAttribute('data-block-end', String(blockInfo.endLine));
    }
}
