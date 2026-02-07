import { EditorState } from '@codemirror/state';
import { DocLike, ParsedLine } from '../core/types';
import { parseLineWithQuote as parseLineWithQuoteByTabSize } from '../core/line-parser';
import {
    buildIndentStringFromSample as buildIndentStringFromSampleText,
    getIndentUnitWidth as getIndentUnitWidthFromSample,
} from '../core/block-mutation';

export function getTabSize(state?: EditorState): number {
    const tabSize = state?.facet(EditorState.tabSize) ?? 4;
    return tabSize > 0 ? tabSize : 4;
}

export function parseLineWithQuote(line: string, state?: EditorState): ParsedLine {
    return parseLineWithQuoteByTabSize(line, getTabSize(state));
}

export function getIndentUnitWidthFromDoc(
    doc: DocLike,
    parseLine: (line: string) => ParsedLine,
    state?: EditorState
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
        if (state) {
            const tabSize = state.facet(EditorState.tabSize);
            return tabSize > 0 ? tabSize : undefined;
        }
        return undefined;
    }
    return Math.max(2, best);
}

export function getIndentUnitWidthForDoc(
    doc: DocLike,
    parseLine: (line: string) => ParsedLine,
    state?: EditorState
): number {
    const fromDoc = getIndentUnitWidthFromDoc(doc, parseLine, state);
    if (typeof fromDoc === 'number') return fromDoc;
    const tabSize = getTabSize(state);
    return tabSize > 0 ? tabSize : 4;
}

export function buildIndentStringFromSample(sample: string, width: number, state?: EditorState): string {
    return buildIndentStringFromSampleText(sample, width, getTabSize(state));
}

export function getIndentUnitWidth(sample: string, state?: EditorState): number {
    return getIndentUnitWidthFromSample(sample, getTabSize(state));
}
