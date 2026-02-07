import { DocLike, ParsedLine } from '../core/protocol-types';
import { parseLineWithQuote as parseLineWithQuoteByTabSize } from '../core/line-parsing';
import {
    buildIndentStringFromSample as buildIndentStringFromSampleText,
    getIndentUnitWidth as getIndentUnitWidthFromSample,
} from '../core/block-mutation';

export function normalizeTabSize(tabSize?: number): number {
    const safe = tabSize ?? 4;
    return safe > 0 ? safe : 4;
}

export function parseLineWithQuote(line: string, tabSize: number): ParsedLine {
    return parseLineWithQuoteByTabSize(line, normalizeTabSize(tabSize));
}

export function getIndentUnitWidthFromDoc(
    doc: DocLike,
    parseLine: (line: string) => ParsedLine,
    fallbackTabSize?: number
): number | undefined {
    let best = Number.POSITIVE_INFINITY;
    let prevIndent: number | null = null;

    for (let i = 1; i <= doc.lines; i++) {
        const text = doc.line(i).text;
        const parsed = parseLine(text);
        if (!parsed.isListItem) continue;
        if (prevIndent !== null && parsed.indentWidth > prevIndent) {
            const delta = parsed.indentWidth - prevIndent;
            if (delta > 0 && delta < best) best = delta;
        }
        prevIndent = parsed.indentWidth;
    }

    if (!isFinite(best)) {
        return normalizeTabSize(fallbackTabSize);
    }
    return Math.max(2, best);
}

export function getIndentUnitWidthForDoc(
    doc: DocLike,
    parseLine: (line: string) => ParsedLine,
    fallbackTabSize?: number
): number {
    const fromDoc = getIndentUnitWidthFromDoc(doc, parseLine, fallbackTabSize);
    if (typeof fromDoc === 'number') return fromDoc;
    return normalizeTabSize(fallbackTabSize);
}

export function buildIndentStringFromSample(sample: string, width: number, tabSize: number): string {
    return buildIndentStringFromSampleText(sample, width, normalizeTabSize(tabSize));
}

export function getIndentUnitWidth(sample: string, tabSize: number): number {
    return getIndentUnitWidthFromSample(sample, normalizeTabSize(tabSize));
}
