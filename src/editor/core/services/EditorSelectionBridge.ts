import type { EditorView } from '@codemirror/view';
import type { LineRange } from '../../../types';
import { resolveBlockBoundaryAtLine, resolveBlockAlignedLineRange } from '../../interaction/RangeSelectionLogic';

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
        const selection = this.view.state.selection;
        const main = selection.main;

        // Empty selection (just cursor position) is not a valid selection
        if (main.empty) {
            return null;
        }

        const doc = this.view.state.doc;
        const fromLine = doc.lineAt(main.from).number;
        const toLine = doc.lineAt(main.to).number;

        return {
            from: main.from,
            to: main.to,
            fromLine,
            toLine,
        };
    }

    /**
     * Check if a line number is within the current editor selection.
     */
    isLineInSelection(lineNumber: number): boolean {
        const selection = this.getTextSelection();
        if (!selection) return false;
        return lineNumber >= selection.fromLine && lineNumber <= selection.toLine;
    }

    /**
     * Convert the current editor selection to block-aligned line ranges.
     * This ensures that partial selections are expanded to include complete blocks.
     * @returns Block-aligned line ranges, or null if no valid selection
     */
    resolveBlockAlignedSelection(): LineRange[] | null {
        const selection = this.getTextSelection();
        if (!selection) return null;

        const state = this.view.state;

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

        return [{
            startLineNumber: aligned.startLineNumber,
            endLineNumber: aligned.endLineNumber,
        }];
    }

    /**
     * Check if a line number intersects with the editor selection.
     * If it does, return the block-aligned selection ranges.
     * @param lineNumber The line number to check (1-indexed)
     * @returns Block-aligned ranges if the line intersects, null otherwise
     */
    getBlockAlignedRangeIfIntersecting(lineNumber: number): LineRange[] | null {
        const selection = this.getTextSelection();
        if (!selection) return null;

        // Check if the line is within the selection range
        if (!this.isLineInSelection(lineNumber)) return null;

        // Return the block-aligned selection
        return this.resolveBlockAlignedSelection();
    }
}
