import type { EditorView } from '@codemirror/view';
import type { LineRange } from '../../../types';
import {
    mergeLineRanges,
    resolveBlockAlignedLineRange,
    resolveBlockBoundaryAtLine,
} from '../../interaction/RangeSelectionLogic';

export type EditorTextSelection = {
    from: number;
    to: number;
    fromLine: number;
    toLine: number;
};

/**
 * Bridge between CodeMirror editor selection and block-based selection.
 * Reads the editor's native text selection and converts it to line ranges
 * that can be used for block-aligned multi-line selection.
 */
export class EditorSelectionBridge {
    constructor(private readonly view: EditorView) {}

    /**
     * Get the current text selection in the editor.
     * @returns Selection info if there's a valid non-empty selection, null otherwise
     */
    getTextSelection(): EditorTextSelection | null {
        return this.getTextSelections()[0] ?? null;
    }

    /**
     * Get all non-empty text selections in the editor.
     * Supports multi-range selections (e.g. multiple carets/ranges).
     */
    getTextSelections(): EditorTextSelection[] {
        const doc = this.view.state.doc;
        const ranges = this.view.state.selection.ranges;
        const selections: EditorTextSelection[] = [];

        for (const range of ranges) {
            if (range.empty) continue;
            const fromLine = doc.lineAt(range.from).number;
            const toLine = doc.lineAt(range.to).number;
            selections.push({
                from: range.from,
                to: range.to,
                fromLine,
                toLine,
            });
        }
        return selections;
    }

    /**
     * Check if a line number is within the current editor selection.
     */
    isLineInSelection(lineNumber: number): boolean {
        const selections = this.getTextSelections();
        if (selections.length === 0) return false;
        return selections.some((selection) => (
            lineNumber >= selection.fromLine && lineNumber <= selection.toLine
        ));
    }

    /**
     * Convert the current editor selection to block-aligned line ranges.
     * This ensures that partial selections are expanded to include complete blocks.
     * @returns Block-aligned line ranges, or null if no valid selection
     */
    resolveBlockAlignedSelection(): LineRange[] | null {
        const selections = this.getTextSelections();
        if (selections.length === 0) return null;

        const state = this.view.state;
        const docLines = state.doc.lines;
        const ranges: LineRange[] = [];

        for (const selection of selections) {
            // Get the block boundaries at the selection start and end
            const startBoundary = resolveBlockBoundaryAtLine(state, selection.fromLine);
            const endBoundary = resolveBlockBoundaryAtLine(state, selection.toLine);

            // Resolve to block-aligned range
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
     * Check if a line number intersects with the editor selection.
     * If it does, return the block-aligned selection ranges.
     * @param lineNumber The line number to check (1-indexed)
     * @returns Block-aligned ranges if the line intersects, null otherwise
     */
    getBlockAlignedRangeIfIntersecting(lineNumber: number): LineRange[] | null {
        return this.getBlockAlignedRangeIfRangeIntersecting(lineNumber, lineNumber);
    }

    /**
     * Check if a line range intersects with the editor selection.
     * If it does, return the block-aligned selection ranges.
     * @param startLineNumber Inclusive start line number (1-indexed)
     * @param endLineNumber Inclusive end line number (1-indexed)
     */
    getBlockAlignedRangeIfRangeIntersecting(startLineNumber: number, endLineNumber: number): LineRange[] | null {
        const selections = this.getTextSelections();
        if (selections.length === 0) return null;

        const safeStart = Math.min(startLineNumber, endLineNumber);
        const safeEnd = Math.max(startLineNumber, endLineNumber);

        // Trigger only when clicked range intersects at least one text selection range.
        const intersects = selections.some((selection) => (
            safeEnd >= selection.fromLine && safeStart <= selection.toLine
        ));
        if (!intersects) return null;

        // Return the block-aligned selection
        return this.resolveBlockAlignedSelection();
    }
}
