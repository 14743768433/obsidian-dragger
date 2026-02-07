import {
    adjustListToTargetContext as adjustListToTargetContextText,
    buildTargetMarker as buildTargetMarkerText,
    getListContext as getListContextFromDoc,
} from '../core/block-mutation';
import { DocLike, ListContext, ListContextValue, MarkerType, ParsedLine } from '../core/types';

export function getListContext(
    doc: DocLike,
    lineNumber: number,
    parseLineWithQuote: (line: string) => ParsedLine
): ListContext {
    return getListContextFromDoc(doc, lineNumber, parseLineWithQuote);
}

export function buildTargetMarker(
    target: Pick<ListContextValue, 'markerType'>,
    source: { markerType: MarkerType; marker: string }
): string {
    return buildTargetMarkerText(target, source);
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
    return adjustListToTargetContextText(params);
}
