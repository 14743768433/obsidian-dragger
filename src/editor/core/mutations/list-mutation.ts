import { DocLike, ListContext, ListContextValue, MarkerType, ParsedLine } from '../protocol-types';

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
): ListContext {
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
