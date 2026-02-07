import { EditorView } from '@codemirror/view';
import { detectBlock } from '../block-detector';
import { BlockType } from '../../types';
import {
    getLineRect as getLineRectByLineNumber,
    getInsertionAnchorY as getInsertionAnchorYByLineNumber,
    getLineIndentPosByWidth as getLineIndentPosByWidthWithTabSize,
    getBlockRect as getBlockRectByRange,
} from '../core/drop-target';
import { clampTargetLineNumber } from '../utils/coordinate-utils';
import { LineParsingService } from './LineParsingService';

export class GeometryCalculator {
    constructor(
        private readonly view: EditorView,
        private readonly lineParsingService: LineParsingService
    ) { }

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
            this.lineParsingService.getTabSize()
        );
    }

    getBlockRect(startLineNumber: number, endLineNumber: number): { top: number; left: number; width: number; height: number } | undefined {
        return getBlockRectByRange(this.view, startLineNumber, endLineNumber);
    }
}
