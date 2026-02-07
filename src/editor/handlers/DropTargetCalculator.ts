import { EditorView } from '@codemirror/view';
import { detectBlock } from '../block-detector';
import { BlockInfo, BlockType } from '../../types';
import { ParsedLine } from '../core/types';
import { EMBED_BLOCK_SELECTOR } from '../core/selectors';
import { isPointInsideRenderedTableCell } from '../core/table-guard';

type DropTargetInfo = {
    lineNumber: number;
    indicatorY: number;
    listContextLineNumber?: number;
    listIndentDelta?: number;
    listTargetIndentWidth?: number;
    lineRect?: { left: number; width: number };
    highlightRect?: { top: number; left: number; width: number; height: number };
};

export interface DropTargetCalculatorDeps {
    parseLineWithQuote: (line: string) => ParsedLine;
    getAdjustedTargetLocation: (view: EditorView, lineNumber: number, options?: { clientY?: number }) => { lineNumber: number; blockAdjusted: boolean };
    clampTargetLineNumber: (totalLines: number, lineNumber: number) => number;
    getPreviousNonEmptyLineNumber: (doc: { line: (n: number) => { text: string }; lines: number }, lineNumber: number) => number | null;
    shouldPreventDropIntoDifferentContainer: (view: EditorView, sourceBlock: BlockInfo, targetLineNumber: number) => boolean;
    getBlockInfoForEmbed: (view: EditorView, embedEl: HTMLElement) => BlockInfo | null;
    getIndentUnitWidthForDoc: (doc: { line: (n: number) => { text: string }; lines: number }, state?: any) => number;
    getLineRect: (view: EditorView, lineNumber: number) => { left: number; width: number } | undefined;
    getInsertionAnchorY: (view: EditorView, lineNumber: number) => number | null;
    getLineIndentPosByWidth: (view: EditorView, lineNumber: number, targetIndentWidth: number) => number | null;
    getBlockRect: (view: EditorView, startLineNumber: number, endLineNumber: number) => { top: number; left: number; width: number; height: number } | undefined;
    clampNumber: (value: number, min: number, max: number) => number;
}

export class DropTargetCalculator {
    constructor(
        private readonly view: EditorView,
        private readonly deps: DropTargetCalculatorDeps
    ) { }

    getDropTargetInfo(info: { clientX: number; clientY: number; dragSource?: BlockInfo | null }): DropTargetInfo | null {
        if (isPointInsideRenderedTableCell(this.view, info.clientX, info.clientY)) {
            return null;
        }
        const dragSource = info.dragSource ?? null;
        const embedEl = this.getEmbedElementAtPoint(info.clientX, info.clientY);
        if (embedEl) {
            const block = this.deps.getBlockInfoForEmbed(this.view, embedEl);
            if (block) {
                const rect = embedEl.getBoundingClientRect();
                const showAtBottom = info.clientY > rect.top + rect.height / 2;
                const lineNumber = this.deps.clampTargetLineNumber(this.view.state.doc.lines, showAtBottom ? block.endLine + 2 : block.startLine + 1);
                if (dragSource && this.deps.shouldPreventDropIntoDifferentContainer(this.view, dragSource, lineNumber)) {
                    return null;
                }
                const indicatorY = showAtBottom ? rect.bottom : rect.top;
                return { lineNumber, indicatorY, lineRect: { left: rect.left, width: rect.width } };
            }
        }

        const vertical = this.computeVerticalTarget(info);
        if (!vertical) return null;
        if (dragSource && this.deps.shouldPreventDropIntoDifferentContainer(this.view, dragSource, vertical.targetLineNumber)) {
            return null;
        }

        const listTarget = this.computeListTarget({
            targetLineNumber: vertical.targetLineNumber,
            lineNumber: vertical.line.number,
            forcedLineNumber: vertical.forcedLineNumber,
            childIntentOnLine: vertical.childIntentOnLine,
            dragSource,
            clientX: info.clientX,
        });

        const indicatorY = this.deps.getInsertionAnchorY(this.view, vertical.targetLineNumber);
        if (indicatorY === null) return null;

        const lineRectSourceLineNumber = listTarget.lineRectSourceLineNumber
            ?? vertical.lineRectSourceLineNumber;
        let lineRect = this.deps.getLineRect(this.view, lineRectSourceLineNumber);
        if (typeof listTarget.listTargetIndentWidth === 'number') {
            const indentPos = this.deps.getLineIndentPosByWidth(this.view, lineRectSourceLineNumber, listTarget.listTargetIndentWidth);
            if (indentPos !== null) {
                const start = this.view.coordsAtPos(indentPos);
                const end = this.view.coordsAtPos(this.view.state.doc.line(lineRectSourceLineNumber).to);
                if (start && end) {
                    const left = start.left;
                    const width = Math.max(8, (end.right ?? end.left) - left);
                    lineRect = { left, width };
                }
            }
        }
        return {
            lineNumber: vertical.targetLineNumber,
            indicatorY,
            listContextLineNumber: listTarget.listContextLineNumber,
            listIndentDelta: listTarget.listIndentDelta,
            listTargetIndentWidth: listTarget.listTargetIndentWidth,
            lineRect,
            highlightRect: listTarget.highlightRect,
        };
    }

    private computeVerticalTarget(info: { clientX: number; clientY: number }): {
        line: { number: number; text: string; from: number; to: number };
        targetLineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        lineRectSourceLineNumber: number;
    } | null {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const x = this.deps.clampNumber(info.clientX, contentRect.left + 2, contentRect.right - 2);
        const pos = this.view.posAtCoords({ x, y: info.clientY });
        if (pos === null) return null;

        const line = this.view.state.doc.lineAt(pos);
        const lineBoundsForSnap = this.getListMarkerBounds(line.number);
        const lineParsedForSnap = this.deps.parseLineWithQuote(line.text);
        const childIntentOnLine = !!lineBoundsForSnap
            && lineParsedForSnap.isListItem
            && info.clientX >= lineBoundsForSnap.contentStartX + 2;

        const adjustedTarget = this.deps.getAdjustedTargetLocation(this.view, line.number, { clientY: info.clientY });
        let forcedLineNumber: number | null = adjustedTarget.blockAdjusted ? adjustedTarget.lineNumber : null;

        let showAtBottom = false;
        if (!forcedLineNumber) {
            const isBlankLine = line.text.trim().length === 0;
            showAtBottom = !isBlankLine;
            if (isBlankLine) {
                forcedLineNumber = line.number;
            } else {
                const lineStart = this.view.coordsAtPos(line.from);
                const lineEnd = this.view.coordsAtPos(line.to);
                if (lineStart && lineEnd) {
                    const midY = (lineStart.top + lineEnd.bottom) / 2;
                    showAtBottom = info.clientY > midY;
                }
            }
        }

        let targetLineNumber = this.deps.clampTargetLineNumber(
            this.view.state.doc.lines,
            forcedLineNumber ?? (showAtBottom ? line.number + 1 : line.number)
        );
        if (!forcedLineNumber && childIntentOnLine && !showAtBottom) {
            targetLineNumber = this.deps.clampTargetLineNumber(this.view.state.doc.lines, line.number + 1);
        }

        return {
            line,
            targetLineNumber,
            forcedLineNumber,
            childIntentOnLine,
            lineRectSourceLineNumber: line.number,
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
            highlightRect: this.deps.getBlockRect(this.view, blockStartLineNumber, blockEndLineNumber),
        };
    }

    private computeListTarget(params: {
        targetLineNumber: number;
        lineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        dragSource: BlockInfo | null;
        clientX: number;
    }): {
        listContextLineNumber?: number;
        listIndentDelta?: number;
        listTargetIndentWidth?: number;
        highlightRect?: { top: number; left: number; width: number; height: number };
        lineRectSourceLineNumber?: number;
    } {
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

        const indentUnit = this.deps.getIndentUnitWidthForDoc(doc, this.view.state);
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
        const indentUnit = this.deps.getIndentUnitWidthForDoc(doc, this.view.state);
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

    private getListMarkerBounds(lineNumber: number): { markerStartX: number; contentStartX: number } | null {
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

    private getEmbedElementAtPoint(clientX: number, clientY: number): HTMLElement | null {
        const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
        if (el) {
            const direct = el.closest(EMBED_BLOCK_SELECTOR) as HTMLElement | null;
            if (direct) {
                return (direct.closest('.cm-embed-block') as HTMLElement | null) ?? direct;
            }
        }

        const editorRect = this.view.dom.getBoundingClientRect();
        if (clientY < editorRect.top || clientY > editorRect.bottom) return null;
        if (clientX < editorRect.left || clientX > editorRect.right) return null;

        const embeds = Array.from(
            this.view.dom.querySelectorAll(EMBED_BLOCK_SELECTOR)
        ) as HTMLElement[];

        let best: HTMLElement | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const raw of embeds) {
            const embed = (raw.closest('.cm-embed-block') as HTMLElement | null) ?? raw;
            const rect = embed.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                const centerY = (rect.top + rect.bottom) / 2;
                const dist = Math.abs(centerY - clientY);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = embed;
                }
            }
        }

        return best;
    }
}
