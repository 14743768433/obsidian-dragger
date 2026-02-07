import { BlockType } from '../../types';
import { DocLike, ListContext, ListContextValue, MarkerType, ParsedLine } from './types';

export function stripBlockquoteDepth(line: string, removeDepth: number): string {
    let remaining = line;
    let removed = 0;
    while (removed < removeDepth) {
        const match = remaining.match(/^(\s*> ?)/);
        if (!match) break;
        remaining = remaining.slice(match[0].length);
        removed += 1;
    }
    return remaining;
}

export function adjustBlockquoteDepth(
    sourceContent: string,
    targetDepth: number,
    getDepthFromLine: (line: string) => number,
    baseDepthOverride?: number
): string {
    const lines = sourceContent.split('\n');
    let baseDepth = 0;
    if (typeof baseDepthOverride === 'number') {
        baseDepth = baseDepthOverride;
    } else {
        for (const line of lines) {
            if (line.trim().length === 0) continue;
            baseDepth = getDepthFromLine(line);
            break;
        }
    }

    const delta = targetDepth - baseDepth;
    if (delta === 0) return sourceContent;

    return lines.map((line) => {
        if (line.trim().length === 0) {
            return delta > 0 ? `${'> '.repeat(delta)}${line}` : stripBlockquoteDepth(line, -delta);
        }
        if (delta > 0) {
            return `${'> '.repeat(delta)}${line}`;
        }
        return stripBlockquoteDepth(line, -delta);
    }).join('\n');
}

export function getBlockquoteDepthContext(
    doc: DocLike,
    lineNumber: number,
    getDepthFromLine: (line: string) => number
): number {
    if (doc.lines <= 0) return 0;
    const startLine = Math.min(Math.max(1, lineNumber), doc.lines);
    for (let i = startLine; i >= 1; i--) {
        const text = doc.line(i).text;
        // Blank line is a hard boundary: content below it should not inherit quote depth.
        if (text.trim().length === 0) return 0;
        const depth = getDepthFromLine(text);
        if (depth > 0) return depth;
        return 0;
    }
    return 0;
}

export function getContentQuoteDepth(sourceContent: string, getDepthFromLine: (line: string) => number): number {
    const lines = sourceContent.split('\n');
    for (const line of lines) {
        if (line.trim().length === 0) continue;
        return getDepthFromLine(line);
    }
    return 0;
}

export function shouldSeparateBlock(type: BlockType, adjacentLineText: string | null): boolean {
    if (!adjacentLineText) return false;
    if (adjacentLineText.trim().length === 0) return false;

    const trimmed = adjacentLineText.trimStart();
    if (type === BlockType.Blockquote) {
        return false;
    }
    if (type === BlockType.Table) {
        return trimmed.startsWith('|');
    }

    return false;
}

function isBlockquoteLikeLine(line: string | null): boolean {
    if (!line) return false;
    return /^(> ?)+/.test(line.trimStart());
}

function isTableRowLine(line: string | null): boolean {
    if (!line) return false;
    return line.trimStart().startsWith('|');
}

function getFirstNonEmptyLine(content: string): string | null {
    const lines = content.split('\n');
    for (const line of lines) {
        if (line.trim().length === 0) continue;
        return line;
    }
    return null;
}

export function getBoundarySpacing(params: {
    sourceBlockType: BlockType;
    sourceContent: string;
    prevText: string | null;
    nextText: string | null;
}): {
    needsLeadingBlank: boolean;
    needsTrailingBlank: boolean;
    resetQuoteDepth: boolean;
} {
    const { sourceBlockType, sourceContent, prevText, nextText } = params;
    const firstNonEmptySourceLine = getFirstNonEmptyLine(sourceContent);
    const sourceIsQuoteLike = sourceBlockType === BlockType.Blockquote
        || sourceBlockType === BlockType.Callout
        || isBlockquoteLikeLine(firstNonEmptySourceLine);
    const prevIsQuoteLike = isBlockquoteLikeLine(prevText);

    const resetQuoteDepth = prevIsQuoteLike && !sourceIsQuoteLike;

    return {
        needsLeadingBlank: resetQuoteDepth,
        needsTrailingBlank: isTableRowLine(nextText),
        resetQuoteDepth,
    };
}

export function buildTargetMarker(
    target: Pick<ListContextValue, 'markerType'>,
    source: { markerType: MarkerType; marker: string }
): string {
    if (target.markerType === 'ordered') return '1. ';
    if (target.markerType === 'task') {
        if (source.markerType === 'task') return source.marker.replace(/^\s*[-*+]\s\[[ xX]\]\s+/, '- [ ] ');
        return '- [ ] ';
    }
    return '- ';
}

export function buildIndentStringFromSample(sample: string, width: number, tabSize: number): string {
    const safeWidth = Math.max(0, width);
    if (safeWidth === 0) return '';
    if (sample.includes('\t')) {
        const tabs = Math.max(0, Math.round(safeWidth / tabSize));
        return '\t'.repeat(tabs);
    }
    return ' '.repeat(safeWidth);
}

export function getIndentUnitWidth(sample: string, tabSize: number): number {
    if (sample.includes('\t')) return tabSize;
    if (sample.length >= tabSize) return tabSize;
    return sample.length > 0 ? sample.length : tabSize;
}

export function getListContext(
    doc: DocLike,
    lineNumber: number,
    parseLineWithQuote: (line: string) => ParsedLine
): ListContext | null {
    const current = lineNumber <= doc.lines ? doc.line(lineNumber).text : '';
    const currentParsed = parseLineWithQuote(current);
    if (currentParsed.isListItem) {
        return { indentWidth: currentParsed.indentWidth, indentRaw: currentParsed.indentRaw, markerType: currentParsed.markerType };
    }

    const prevLineNumber = lineNumber - 1;
    if (prevLineNumber >= 1) {
        const prevText = doc.line(prevLineNumber).text;
        const prevParsed = parseLineWithQuote(prevText);
        if (prevParsed.isListItem) {
            return { indentWidth: prevParsed.indentWidth, indentRaw: prevParsed.indentRaw, markerType: prevParsed.markerType };
        }
    }

    return null;
}

export function getSourceListBase(
    lines: string[],
    parseLineWithQuote: (line: string) => ParsedLine
): { indentWidth: number; indentRaw: string } | null {
    for (const line of lines) {
        const parsed = parseLineWithQuote(line);
        if (parsed.isListItem) {
            return { indentWidth: parsed.indentWidth, indentRaw: parsed.indentRaw };
        }
    }
    return null;
}

export function adjustListToTargetContext(params: {
    doc: DocLike;
    sourceContent: string;
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getIndentUnitWidth: (sample: string) => number;
    buildIndentStringFromSample: (sample: string, width: number) => string;
    buildTargetMarker: (target: ListContextValue, source: { markerType: MarkerType; marker: string }) => string;
    listContextLineNumberOverride?: number;
    listIndentDeltaOverride?: number;
    listTargetIndentWidthOverride?: number;
}): string {
    const {
        doc,
        sourceContent,
        targetLineNumber,
        parseLineWithQuote,
        getIndentUnitWidth: getIndentUnitWidthFn,
        buildIndentStringFromSample: buildIndentStringFromSampleFn,
        buildTargetMarker: buildTargetMarkerFn,
        listContextLineNumberOverride,
        listIndentDeltaOverride,
        listTargetIndentWidthOverride,
    } = params;

    const lines = sourceContent.split('\n');
    const sourceBase = getSourceListBase(lines, parseLineWithQuote);
    if (!sourceBase) return sourceContent;

    const listContextLineNumber = listContextLineNumberOverride ?? targetLineNumber;
    const targetContext = getListContext(doc, listContextLineNumber, parseLineWithQuote);
    const indentSample = targetContext ? targetContext.indentRaw : sourceBase.indentRaw;
    const indentDeltaBase = (targetContext ? targetContext.indentWidth : 0) - sourceBase.indentWidth;
    const indentUnitWidth = getIndentUnitWidthFn(indentSample || sourceBase.indentRaw);
    let indentDelta = indentDeltaBase + ((listIndentDeltaOverride ?? 0) * indentUnitWidth);
    if (typeof listTargetIndentWidthOverride === 'number') {
        indentDelta = listTargetIndentWidthOverride - sourceBase.indentWidth;
    }

    const quoteAdjustedLines = lines.map((line) => {
        if (line.trim().length === 0) return line;
        const parsed = parseLineWithQuote(line);
        const rest = parsed.rest;
        if (!parsed.isListItem) {
            if (parsed.indentWidth >= sourceBase.indentWidth) {
                const newIndent = buildIndentStringFromSampleFn(indentSample, parsed.indentWidth + indentDelta);
                return `${parsed.quotePrefix}${newIndent}${rest.slice(parsed.indentRaw.length)}`;
            }
            return line;
        }

        const newIndent = buildIndentStringFromSampleFn(indentSample, parsed.indentWidth + indentDelta);
        let marker = parsed.marker;
        if (targetContext && parsed.indentWidth === sourceBase.indentWidth) {
            marker = buildTargetMarkerFn(targetContext, parsed);
        }
        return `${parsed.quotePrefix}${newIndent}${marker}${parsed.content}`;
    });

    return quoteAdjustedLines.join('\n');
}

export function buildInsertText(params: {
    doc: DocLike;
    sourceBlockType: BlockType;
    sourceContent: string;
    targetLineNumber: number;
    getBlockquoteDepthContext: (doc: DocLike, lineNumber: number) => number;
    getContentQuoteDepth: (sourceContent: string) => number;
    adjustBlockquoteDepth: (sourceContent: string, targetDepth: number, baseDepthOverride?: number) => string;
    adjustListToTargetContext: (sourceContent: string) => string;
}): string {
    const {
        doc,
        sourceBlockType,
        sourceContent,
        targetLineNumber,
        getBlockquoteDepthContext: getBlockquoteDepthContextFn,
        getContentQuoteDepth: getContentQuoteDepthFn,
        adjustBlockquoteDepth: adjustBlockquoteDepthFn,
        adjustListToTargetContext: adjustListToTargetContextFn,
    } = params;

    const prevLineNumber = Math.min(Math.max(1, targetLineNumber - 1), doc.lines);
    const prevText = targetLineNumber > 1 ? doc.line(prevLineNumber).text : null;
    const nextText = targetLineNumber <= doc.lines ? doc.line(targetLineNumber).text : null;
    const boundarySpacing = getBoundarySpacing({
        sourceBlockType,
        sourceContent,
        prevText,
        nextText,
    });

    let text = sourceContent;
    const shouldLockQuoteDepth = sourceBlockType === BlockType.CodeBlock
        || sourceBlockType === BlockType.Table
        || sourceBlockType === BlockType.MathBlock
        || sourceBlockType === BlockType.Callout;
    if (!shouldLockQuoteDepth) {
        const targetQuoteDepth = boundarySpacing.resetQuoteDepth
            ? 0
            : getBlockquoteDepthContextFn(doc, targetLineNumber);
        const sourceQuoteDepth = getContentQuoteDepthFn(sourceContent);
        const isBlockquoteDrag = sourceBlockType === BlockType.Blockquote;
        const effectiveSourceDepth = (isBlockquoteDrag && targetQuoteDepth < sourceQuoteDepth)
            ? Math.max(0, sourceQuoteDepth - 1)
            : sourceQuoteDepth;
        text = adjustBlockquoteDepthFn(text, targetQuoteDepth, effectiveSourceDepth);
    }
    text = adjustListToTargetContextFn(text);

    if (boundarySpacing.needsLeadingBlank) text = '\n' + text;
    const trailingNewlines = 1 + (boundarySpacing.needsTrailingBlank ? 1 : 0);
    text += '\n'.repeat(trailingNewlines);
    return text;
}
