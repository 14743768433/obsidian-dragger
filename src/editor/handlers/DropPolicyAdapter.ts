import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { detectBlock } from '../block-detector';
import { BlockInfo, BlockType } from '../../types';
import { shouldPreventDropIntoDifferentContainer as shouldPreventDropIntoContainer } from '../core/container-policy';
import { buildInsertText as buildInsertTextByPolicy } from '../core/block-mutation';
import {
    getLineRect as getLineRectByLineNumber,
    getInsertionAnchorY as getInsertionAnchorYByLineNumber,
    getLineIndentPosByWidth as getLineIndentPosByWidthWithTabSize,
    getBlockRect as getBlockRectByRange,
} from '../core/drop-target';
import {
    buildIndentStringFromSample,
    getIndentUnitWidth,
    getIndentUnitWidthForDoc,
    parseLineWithQuote,
    getTabSize,
} from '../utils/indent-utils';
import {
    adjustBlockquoteDepth,
    getBlockquoteDepthContext,
    getContentQuoteDepth,
} from '../utils/blockquote-utils';
import {
    adjustListToTargetContext,
    buildTargetMarker,
    getListContext,
} from '../utils/list-utils';
import { clampTargetLineNumber } from '../utils/coordinate-utils';
import { DocLike, ListContext, ParsedLine } from '../core/types';

export class DropPolicyAdapter {
    constructor(private readonly view: EditorView) { }

    parseLineWithQuote(line: string): ParsedLine {
        return parseLineWithQuote(line, this.view.state);
    }

    getListContext(doc: DocLike, lineNumber: number): ListContext {
        return getListContext(doc, lineNumber, (line) => this.parseLineWithQuote(line));
    }

    getIndentUnitWidth(sample: string): number {
        return getIndentUnitWidth(sample, this.view.state);
    }

    getIndentUnitWidthForDoc(
        doc: DocLike,
        state?: EditorState
    ): number {
        return getIndentUnitWidthForDoc(
            doc,
            (line) => parseLineWithQuote(line, state ?? this.view.state),
            state
        );
    }

    buildInsertText(
        doc: DocLike,
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        sourceContent: string,
        listContextLineNumberOverride?: number,
        listIndentDeltaOverride?: number,
        listTargetIndentWidthOverride?: number
    ): string {
        return buildInsertTextByPolicy({
            doc,
            sourceBlockType: sourceBlock.type,
            sourceContent,
            targetLineNumber,
            getBlockquoteDepthContext,
            getContentQuoteDepth,
            adjustBlockquoteDepth: (content, targetDepth, baseDepth) =>
                adjustBlockquoteDepth(content, targetDepth, baseDepth),
            adjustListToTargetContext: (content) => adjustListToTargetContext({
                doc,
                sourceContent: content,
                targetLineNumber,
                parseLineWithQuote: (line) => this.parseLineWithQuote(line),
                getIndentUnitWidth: (sample) => this.getIndentUnitWidth(sample),
                buildIndentStringFromSample: (sample, width) =>
                    buildIndentStringFromSample(sample, width, this.view.state),
                buildTargetMarker,
                listContextLineNumberOverride,
                listIndentDeltaOverride,
                listTargetIndentWidthOverride,
            }),
        });
    }

    shouldPreventDropIntoDifferentContainer(
        sourceBlock: BlockInfo,
        targetLineNumber: number
    ): boolean {
        return shouldPreventDropIntoContainer(this.view.state, sourceBlock, targetLineNumber, detectBlock as any);
    }

    getAdjustedTargetLocation(
        lineNumber: number,
        options?: { clientY?: number }
    ): { lineNumber: number; blockAdjusted: boolean } {
        const doc = this.view.state.doc;
        if (lineNumber < 1 || lineNumber > doc.lines) {
            return { lineNumber: clampTargetLineNumber(doc.lines, lineNumber), blockAdjusted: false };
        }

        const block = detectBlock(this.view.state, lineNumber);
        if (!block || (block.type !== BlockType.CodeBlock && block.type !== BlockType.Table && block.type !== BlockType.MathBlock)) {
            return { lineNumber, blockAdjusted: false };
        }

        if (typeof options?.clientY === 'number') {
            const blockStartLine = doc.line(block.startLine + 1);
            const blockEndLine = doc.line(block.endLine + 1);
            const startCoords = this.view.coordsAtPos(blockStartLine.from);
            const endCoords = this.view.coordsAtPos(blockEndLine.to);
            if (startCoords && endCoords) {
                const midPoint = (startCoords.top + endCoords.bottom) / 2;
                const insertAfter = options.clientY > midPoint;
                const adjustedLineNumber = insertAfter ? block.endLine + 2 : block.startLine + 1;
                return {
                    lineNumber: clampTargetLineNumber(doc.lines, adjustedLineNumber),
                    blockAdjusted: true,
                };
            }
        }

        const lineIndex = lineNumber - 1;
        const midLine = (block.startLine + block.endLine) / 2;
        const adjustedLineNumber = lineIndex <= midLine ? block.startLine + 1 : block.endLine + 2;
        return {
            lineNumber: clampTargetLineNumber(doc.lines, adjustedLineNumber),
            blockAdjusted: true,
        };
    }

    getLineRect(lineNumber: number): { left: number; width: number } | undefined {
        return getLineRectByLineNumber(this.view, lineNumber);
    }

    getInsertionAnchorY(lineNumber: number): number | null {
        return getInsertionAnchorYByLineNumber(this.view, lineNumber);
    }

    getLineIndentPosByWidth(lineNumber: number, targetIndentWidth: number): number | null {
        return getLineIndentPosByWidthWithTabSize(
            this.view,
            lineNumber,
            targetIndentWidth,
            getTabSize(this.view.state)
        );
    }

    getBlockRect(startLineNumber: number, endLineNumber: number): { top: number; left: number; width: number; height: number } | undefined {
        return getBlockRectByRange(this.view, startLineNumber, endLineNumber);
    }
}
