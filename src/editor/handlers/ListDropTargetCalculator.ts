import { EditorView } from '@codemirror/view';
import { detectBlock } from '../block-detector';
import { BlockInfo, BlockType } from '../../types';
import { DocLike, ParsedLine } from '../core/protocol-types';

export type ListDropTargetInfo = {
    listContextLineNumber?: number;
    listIndentDelta?: number;
    listTargetIndentWidth?: number;
    highlightRect?: { top: number; left: number; width: number; height: number };
    lineRectSourceLineNumber?: number;
};

export interface ListDropTargetCalculatorDeps {
    parseLineWithQuote: (line: string) => ParsedLine;
    getPreviousNonEmptyLineNumber: (doc: DocLike, lineNumber: number) => number | null;
    getIndentUnitWidthForDoc: (doc: DocLike) => number;
    getBlockRect: (startLineNumber: number, endLineNumber: number) => { top: number; left: number; width: number; height: number } | undefined;
}

export class ListDropTargetCalculator {
    constructor(
        private readonly view: EditorView,
        private readonly deps: ListDropTargetCalculatorDeps
    ) { }

    getListMarkerBounds(lineNumber: number): { markerStartX: number; contentStartX: number } | null {
        if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) return null;
        const line = this.view.state.doc.line(lineNumber);
        const parsed = this.deps.parseLineWithQuote(line.text);
        if (!parsed.isListItem) return null;

        const markerStartPos = line.from + parsed.quotePrefix.length + parsed.indentRaw.length;
        const contentStartPos = markerStartPos + parsed.marker.length;
        const markerStart = this.view.coordsAtPos(markerStartPos);
        const contentStart = this.view.coordsAtPos(contentStartPos);
        if (!markerStart || !contentStart) return null;
        return {
            markerStartX: markerStart.left,
            contentStartX: contentStart.left,
        };
    }

    computeListTarget(params: {
        targetLineNumber: number;
        lineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        dragSource: BlockInfo | null;
        clientX: number;
    }): ListDropTargetInfo {
        const { targetLineNumber, lineNumber, forcedLineNumber, childIntentOnLine, dragSource, clientX } = params;
        if (!dragSource || dragSource.type !== BlockType.ListItem) return {};

        const doc = this.view.state.doc;
        const prevNonEmptyLineNumber = this.deps.getPreviousNonEmptyLineNumber(doc, targetLineNumber - 1);
        let referenceLineNumber = prevNonEmptyLineNumber ?? 0;
        if (!forcedLineNumber && childIntentOnLine) {
            referenceLineNumber = lineNumber;
        }
        if (referenceLineNumber < 1) return {};

        const referenceBlock = detectBlock(this.view.state, referenceLineNumber);
        if (!referenceBlock || referenceBlock.type !== BlockType.ListItem) return {};

        const baseLineNumber = referenceBlock.startLine + 1;
        const isSelfTarget = !!dragSource
            && dragSource.type === BlockType.ListItem
            && baseLineNumber === dragSource.startLine + 1;
        const allowChild = !isSelfTarget;
        const dropTarget = this.getListDropTarget(baseLineNumber, clientX, allowChild);
        if (!dropTarget) return {};

        const listContextLineNumber = dropTarget.lineNumber;
        const listIndentDelta = dropTarget.mode === 'child' ? 1 : 0;
        let cappedIndentWidth = dropTarget.indentWidth;

        const indentUnit = this.deps.getIndentUnitWidthForDoc(doc);
        const prevIndent = this.getListIndentWidthAtLine(doc, baseLineNumber);
        if (typeof prevIndent === 'number') {
            const maxAllowedIndent = prevIndent + indentUnit;
            if (cappedIndentWidth > maxAllowedIndent) {
                cappedIndentWidth = maxAllowedIndent;
            }
        }

        const nextLineNumber = targetLineNumber <= doc.lines ? targetLineNumber : null;
        if (nextLineNumber !== null) {
            const nextIndent = this.getListIndentWidthAtLine(doc, nextLineNumber);
            if (typeof nextIndent === 'number') {
                const minAllowedIndent = Math.max(0, nextIndent - indentUnit);
                if (cappedIndentWidth < minAllowedIndent) {
                    cappedIndentWidth = minAllowedIndent;
                }
            }
        }

        const listTargetIndentWidth = cappedIndentWidth;
        const highlightInfo = this.computeHighlightRectForList({
            targetLineNumber,
            listTargetIndentWidth,
            indentUnit,
        });

        return {
            listContextLineNumber,
            listIndentDelta,
            listTargetIndentWidth,
            highlightRect: highlightInfo.highlightRect,
            lineRectSourceLineNumber: highlightInfo.lineRectSourceLineNumber,
        };
    }

    private computeHighlightRectForList(params: { targetLineNumber: number; listTargetIndentWidth: number; indentUnit: number }): {
        highlightRect?: { top: number; left: number; width: number; height: number };
        lineRectSourceLineNumber?: number;
    } {
        const { targetLineNumber, listTargetIndentWidth, indentUnit } = params;
        if (listTargetIndentWidth <= 0) return {};

        const targetParentIndent = listTargetIndentWidth - indentUnit;
        const parentLineNumber = this.findParentLineNumberByIndent(
            this.view.state.doc,
            targetLineNumber - 1,
            targetParentIndent
        );
        if (parentLineNumber === null) return {};

        const highlightBlock = detectBlock(this.view.state, parentLineNumber);
        if (!highlightBlock || highlightBlock.type !== BlockType.ListItem) return {};

        const lineRectSourceLineNumber = highlightBlock.startLine + 1;
        const blockStartLineNumber = highlightBlock.startLine + 1;
        const blockEndLineNumber = highlightBlock.endLine + 1;
        const bounds = this.getListMarkerBounds(blockStartLineNumber);
        const startLineObj = this.view.state.doc.line(blockStartLineNumber);
        const endLineObj = this.view.state.doc.line(blockEndLineNumber);
        const startCoords = this.view.coordsAtPos(startLineObj.from);
        const endCoords = this.view.coordsAtPos(endLineObj.to);
        if (bounds && startCoords && endCoords) {
            const left = bounds.markerStartX;
            let maxRight = left;
            for (let i = blockStartLineNumber; i <= blockEndLineNumber; i++) {
                const lineObj = this.view.state.doc.line(i);
                const lineEndCoords = this.view.coordsAtPos(lineObj.to);
                if (!lineEndCoords) continue;
                const right = lineEndCoords.right ?? lineEndCoords.left;
                if (right > maxRight) {
                    maxRight = right;
                }
            }
            const width = Math.max(8, maxRight - left);
            return {
                lineRectSourceLineNumber,
                highlightRect: {
                    top: startCoords.top,
                    left,
                    width,
                    height: Math.max(4, endCoords.bottom - startCoords.top),
                },
            };
        }

        return {
            lineRectSourceLineNumber,
            highlightRect: this.deps.getBlockRect(blockStartLineNumber, blockEndLineNumber),
        };
    }

    private getListDropTarget(
        lineNumber: number,
        clientX: number,
        allowChild: boolean
    ): { lineNumber: number; indentWidth: number; mode: 'child' | 'same' } | null {
        const doc = this.view.state.doc;
        if (lineNumber < 1 || lineNumber > doc.lines) return null;
        const bounds = this.getListMarkerBounds(lineNumber);
        if (!bounds) return null;

        const slots: Array<{ x: number; lineNumber: number; indentWidth: number; mode: 'child' | 'same' }> = [];

        const baseIndent = this.getListIndentWidthAtLine(doc, lineNumber);
        const indentUnit = this.deps.getIndentUnitWidthForDoc(doc);
        const maxIndent = typeof baseIndent === 'number' ? baseIndent + indentUnit : undefined;
        if (typeof baseIndent === 'number') {
            slots.push({ x: bounds.markerStartX, lineNumber, indentWidth: baseIndent, mode: 'same' });
        }

        if (allowChild && typeof baseIndent === 'number') {
            const childIndent = baseIndent + indentUnit;
            if (maxIndent === undefined || childIndent <= maxIndent) {
                const indentPixels = indentUnit * (this.view.defaultCharacterWidth || 7);
                const childSlotX = bounds.markerStartX + indentPixels;
                slots.push({ x: childSlotX, lineNumber, indentWidth: childIndent, mode: 'child' });
            }
        }

        const ancestors = this.getListAncestorLineNumbers(doc, lineNumber);
        for (const ancestorLine of ancestors) {
            if (ancestorLine === lineNumber) continue;
            const ancestorBounds = this.getListMarkerBounds(ancestorLine);
            if (!ancestorBounds) continue;
            const indentWidth = this.getListIndentWidthAtLine(doc, ancestorLine);
            if (typeof indentWidth !== 'number') continue;
            slots.push({ x: ancestorBounds.markerStartX, lineNumber: ancestorLine, indentWidth, mode: 'same' });
        }

        if (slots.length === 0) return null;

        let best = slots[0];
        let bestDist = Math.abs(clientX - best.x);
        for (let i = 1; i < slots.length; i++) {
            const dist = Math.abs(clientX - slots[i].x);
            if (dist < bestDist) {
                best = slots[i];
                bestDist = dist;
            }
        }

        return { lineNumber: best.lineNumber, indentWidth: best.indentWidth, mode: best.mode };
    }

    private getListIndentWidthAtLine(doc: { line: (n: number) => { text: string }; lines: number }, lineNumber: number): number | undefined {
        if (lineNumber < 1 || lineNumber > doc.lines) return undefined;
        const parsed = this.deps.parseLineWithQuote(doc.line(lineNumber).text);
        if (!parsed.isListItem) return undefined;
        return parsed.indentWidth;
    }

    private getListAncestorLineNumbers(doc: { line: (n: number) => { text: string }; lines: number }, lineNumber: number): number[] {
        const result: number[] = [];
        let currentIndent: number | null = null;

        for (let i = lineNumber; i >= 1; i--) {
            const text = doc.line(i).text;
            if (text.trim().length === 0) continue;
            const parsed = this.deps.parseLineWithQuote(text);
            if (!parsed.isListItem) {
                if (currentIndent !== null) break;
                continue;
            }

            if (currentIndent === null) {
                currentIndent = parsed.indentWidth;
                result.push(i);
                continue;
            }

            if (parsed.indentWidth < currentIndent) {
                currentIndent = parsed.indentWidth;
                result.push(i);
            }
        }

        return result;
    }

    private findParentLineNumberByIndent(
        doc: { line: (n: number) => { text: string }; lines: number },
        startLineNumber: number,
        targetIndent: number
    ): number | null {
        for (let i = startLineNumber; i >= 1; i--) {
            const text = doc.line(i).text;
            if (text.trim().length === 0) continue;
            const parsed = this.deps.parseLineWithQuote(text);
            if (!parsed.isListItem) continue;
            if (parsed.indentWidth === targetIndent) return i;
        }
        return null;
    }
}
