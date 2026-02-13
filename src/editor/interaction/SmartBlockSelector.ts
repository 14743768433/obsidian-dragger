import type { EditorView } from '@codemirror/view';
import type { BlockInfo, LineRange } from '../../types';
import { EditorSelectionBridge } from '../core/services/EditorSelectionBridge';
import { buildDragSourceFromLineRanges, mergeLineRanges } from './RangeSelectionLogic';

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
     * Evaluate whether smart block selection should be triggered based on
     * the clicked block and current editor text selection.
     *
     * @param clickedBlock The block info of the handle that was clicked
     * @returns Smart selection result with ranges and block info if applicable
     */
    evaluate(clickedBlock: BlockInfo): SmartSelectionResult {
        const clickedStartLine = clickedBlock.startLine + 1;
        const clickedEndLine = clickedBlock.endLine + 1;

        // Check if the clicked block range intersects with editor selection.
        const alignedRanges = this.editorSelection.getBlockAlignedRangeIfRangeIntersecting(
            clickedStartLine,
            clickedEndLine
        );
        console.log('[Dragger Debug] SmartBlockSelector.evaluate', {
            clickedBlock: {
                startLine: clickedBlock.startLine,
                endLine: clickedBlock.endLine,
            },
            alignedRanges,
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
     * Get the underlying EditorSelectionBridge instance.
     */
    getEditorSelection(): EditorSelectionBridge {
        return this.editorSelection;
    }
}
