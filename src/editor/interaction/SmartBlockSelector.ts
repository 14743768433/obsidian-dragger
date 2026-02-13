import type { EditorView } from '@codemirror/view';
import type { BlockInfo, LineRange } from '../../types';
import { EditorSelectionBridge, EditorTextSelection } from '../core/services/EditorSelectionBridge';
import {
    buildDragSourceFromLineRanges,
    mergeLineRanges,
    resolveBlockBoundaryAtLine,
    resolveBlockAlignedLineRange,
} from './RangeSelectionLogic';

export type SmartSelectionResult = {
    shouldUseSmartSelection: boolean;
    ranges: LineRange[];
    blockInfo: BlockInfo | null;
};

/**
 * SmartBlockSelector enables text-selection-to-block-selection conversion.
 * When a user has text selected in the editor and clicks a handle within
 * that selection, this module evaluates and returns the block-aligned
 * selection that can be used for multi-block drag operations.
 */
export class SmartBlockSelector {
    private readonly editorSelection: EditorSelectionBridge;

    constructor(private readonly view: EditorView) {
        this.editorSelection = new EditorSelectionBridge(view);
    }

    /**
     * Capture current editor selection as a snapshot.
     * This should be called at the very start of pointerdown event,
     * before the selection might be cleared by browser/editor.
     */
    captureSelectionSnapshot(): EditorTextSelection[] {
        return this.editorSelection.getTextSelections();
    }

    /**
     * Evaluate whether smart block selection should be triggered based on
     * the clicked block and editor text selection.
     *
     * @param clickedBlock The block info of the handle that was clicked
     * @param selectionSnapshot Optional pre-captured selection snapshot.
     *                          If provided, uses this instead of reading live selection.
     * @returns Smart selection result with ranges and block info if applicable
     */
    evaluate(clickedBlock: BlockInfo, selectionSnapshot?: EditorTextSelection[]): SmartSelectionResult {
        const clickedStartLine = clickedBlock.startLine + 1;
        const clickedEndLine = clickedBlock.endLine + 1;

        // Use snapshot if provided, otherwise read live selection
        const alignedRanges = selectionSnapshot
            ? this.getBlockAlignedRangeFromSnapshot(selectionSnapshot, clickedStartLine, clickedEndLine)
            : this.editorSelection.getBlockAlignedRangeIfRangeIntersecting(
                  clickedStartLine,
                  clickedEndLine
              );

        console.log('[Dragger Debug] SmartBlockSelector.evaluate', {
            clickedBlock: {
                startLine: clickedBlock.startLine,
                endLine: clickedBlock.endLine,
            },
            alignedRanges,
            usedSnapshot: !!selectionSnapshot,
        });

        if (!alignedRanges) {
            return {
                shouldUseSmartSelection: false,
                ranges: [],
                blockInfo: null,
            };
        }

        // Merge ranges if needed
        const docLines = this.view.state.doc.lines;
        const mergedRanges = mergeLineRanges(docLines, alignedRanges);

        // Build drag source from line ranges
        const blockInfo = buildDragSourceFromLineRanges(
            this.view.state.doc,
            mergedRanges,
            clickedBlock
        );
        console.log('[Dragger Debug] SmartBlockSelector.result', {
            mergedRanges,
            sourceBlock: {
                startLine: blockInfo.startLine,
                endLine: blockInfo.endLine,
                hasComposite: !!blockInfo.compositeSelection,
            },
        });

        return {
            shouldUseSmartSelection: true,
            ranges: mergedRanges,
            blockInfo,
        };
    }

    /**
     * Get block-aligned ranges from a pre-captured selection snapshot.
     */
    private getBlockAlignedRangeFromSnapshot(
        snapshot: EditorTextSelection[],
        clickedStartLine: number,
        clickedEndLine: number
    ): LineRange[] | null {
        if (snapshot.length === 0) return null;

        const safeStart = Math.min(clickedStartLine, clickedEndLine);
        const safeEnd = Math.max(clickedStartLine, clickedEndLine);

        // Check if clicked range intersects with any selection in snapshot
        const intersects = snapshot.some((selection) => (
            safeEnd >= selection.fromLine && safeStart <= selection.toLine
        ));

        console.log('[Dragger Debug] SmartBlockSelector.getFromSnapshot', {
            snapshot: snapshot.map(s => ({ fromLine: s.fromLine, toLine: s.toLine })),
            clickedRange: { start: safeStart, end: safeEnd },
            intersects,
        });

        if (!intersects) return null;

        // Resolve block-aligned selection from snapshot
        return this.resolveBlockAlignedSelectionFromSnapshot(snapshot);
    }

    /**
     * Resolve block-aligned selection from a pre-captured snapshot.
     */
    private resolveBlockAlignedSelectionFromSnapshot(snapshot: EditorTextSelection[]): LineRange[] | null {
        const state = this.view.state;
        const docLines = state.doc.lines;
        const ranges: LineRange[] = [];

        for (const selection of snapshot) {
            const startBoundary = resolveBlockBoundaryAtLine(state, selection.fromLine);
            const endBoundary = resolveBlockBoundaryAtLine(state, selection.toLine);

            const aligned = resolveBlockAlignedLineRange(
                state,
                startBoundary.startLineNumber,
                startBoundary.endLineNumber,
                endBoundary.startLineNumber,
                endBoundary.endLineNumber
            );
            ranges.push({
                startLineNumber: aligned.startLineNumber,
                endLineNumber: aligned.endLineNumber,
            });
        }

        return mergeLineRanges(docLines, ranges);
    }

    /**
     * Get the underlying EditorSelectionBridge instance.
     */
    getEditorSelection(): EditorSelectionBridge {
        return this.editorSelection;
    }
}
