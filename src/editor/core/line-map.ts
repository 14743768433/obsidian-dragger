import { EditorState } from '@codemirror/state';
import { parseLineWithQuote } from './line-parsing';
import { DocLike, StateWithDoc } from './protocol-types';

export interface LineMeta {
    isEmpty: boolean;
    isList: boolean;
    isQuote: boolean;
    isCallout: boolean;
    isTable: boolean;
    isHr: boolean;
    indentWidth: number;
    quoteDepth: number;
}

export interface LineMap {
    doc: DocLike;
    lineMeta: LineMeta[];
    prevNonEmpty: Int32Array;
    nextNonEmpty: Int32Array;
    prevListLine: Int32Array;
    listParentLine: Int32Array;
    listSubtreeEndLine: Int32Array;
    tabSize: number;
}

type LineMapPerfDurationKey = 'line_map_get' | 'line_map_build';

let lineMapPerfRecorder: ((key: LineMapPerfDurationKey, durationMs: number) => void) | null = null;

const lineMapCache = new WeakMap<object, Map<number, LineMap>>();

function nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function recordLineMapPerf(key: LineMapPerfDurationKey, durationMs: number): void {
    if (!lineMapPerfRecorder) return;
    if (!isFinite(durationMs) || durationMs < 0) return;
    lineMapPerfRecorder(key, durationMs);
}

export function setLineMapPerfRecorder(
    recorder: ((key: LineMapPerfDurationKey, durationMs: number) => void) | null
): void {
    lineMapPerfRecorder = recorder;
}

function normalizeTabSize(tabSize: number | undefined): number {
    const safe = tabSize ?? 4;
    return safe > 0 ? safe : 4;
}

function resolveStateTabSize(state: unknown): number {
    if (!state || typeof state !== 'object') return 4;
    try {
        const withFacet = state as EditorState;
        if (typeof withFacet.facet === 'function') {
            return normalizeTabSize(withFacet.facet(EditorState.tabSize));
        }
    } catch {
        // ignore tab size extraction failures on non-EditorState stubs
    }
    return 4;
}

function isHorizontalRuleLine(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 3) return false;
    return /^([-*_])(?:\s*\1){2,}$/.test(trimmed);
}

function isCalloutLine(text: string): boolean {
    return /^(\s*> ?)+\s*\[!/.test(text.trimStart());
}

export function buildLineMap(
    state: StateWithDoc,
    options?: { tabSize?: number }
): LineMap {
    const doc = state.doc;
    const tabSize = normalizeTabSize(options?.tabSize ?? resolveStateTabSize(state));
    const lineMeta: LineMeta[] = new Array(doc.lines + 1);
    lineMeta[0] = {
        isEmpty: true,
        isList: false,
        isQuote: false,
        isCallout: false,
        isTable: false,
        isHr: false,
        indentWidth: 0,
        quoteDepth: 0,
    };
    const prevNonEmpty = new Int32Array(doc.lines + 2);
    const nextNonEmpty = new Int32Array(doc.lines + 2);
    const prevListLine = new Int32Array(doc.lines + 2);
    const listParentLine = new Int32Array(doc.lines + 2);
    const listSubtreeEndLine = new Int32Array(doc.lines + 2);

    let previous = 0;
    let previousList = 0;
    const listStack: number[] = [];
    for (let i = 1; i <= doc.lines; i++) {
        const text = doc.line(i).text ?? '';
        const parsed = parseLineWithQuote(text, tabSize);
        const isEmpty = text.trim().length === 0;
        const meta: LineMeta = {
            isEmpty,
            isList: parsed.isListItem,
            isQuote: parsed.quoteDepth > 0,
            isCallout: isCalloutLine(text),
            isTable: text.trimStart().startsWith('|'),
            isHr: isHorizontalRuleLine(text),
            indentWidth: parsed.indentWidth,
            quoteDepth: parsed.quoteDepth,
        };
        lineMeta[i] = meta;
        if (!isEmpty) {
            previous = i;
        }
        prevNonEmpty[i] = previous;

        if (isEmpty) {
            prevListLine[i] = previousList;
            continue;
        }

        while (listStack.length > 0) {
            const topLine = listStack[listStack.length - 1];
            const topMeta = lineMeta[topLine];
            if (!topMeta || meta.indentWidth > topMeta.indentWidth) {
                break;
            }
            listStack.pop();
        }

        for (const ancestorLine of listStack) {
            listSubtreeEndLine[ancestorLine] = i;
        }

        prevListLine[i] = previousList;
        if (!meta.isList) {
            continue;
        }
        listParentLine[i] = listStack.length > 0
            ? listStack[listStack.length - 1]
            : 0;
        listSubtreeEndLine[i] = i;
        listStack.push(i);
        previousList = i;
    }

    let next = 0;
    for (let i = doc.lines; i >= 1; i--) {
        if (!lineMeta[i].isEmpty) {
            next = i;
        }
        nextNonEmpty[i] = next;
    }

    return {
        doc,
        lineMeta,
        prevNonEmpty,
        nextNonEmpty,
        prevListLine,
        listParentLine,
        listSubtreeEndLine,
        tabSize,
    };
}

export function getLineMap(
    state: StateWithDoc,
    options?: { tabSize?: number }
): LineMap {
    const startedAt = nowMs();
    const tabSize = normalizeTabSize(options?.tabSize ?? resolveStateTabSize(state));
    if (!state || typeof state !== 'object') {
        const buildStartedAt = nowMs();
        const built = buildLineMap(state, { tabSize });
        recordLineMapPerf('line_map_build', nowMs() - buildStartedAt);
        recordLineMapPerf('line_map_get', nowMs() - startedAt);
        return built;
    }
    const doc = state.doc;
    if (!doc || typeof doc !== 'object') {
        const buildStartedAt = nowMs();
        const built = buildLineMap(state, { tabSize });
        recordLineMapPerf('line_map_build', nowMs() - buildStartedAt);
        recordLineMapPerf('line_map_get', nowMs() - startedAt);
        return built;
    }
    const byTabSize = lineMapCache.get(doc as object);
    const cached = byTabSize?.get(tabSize);
    if (cached) {
        recordLineMapPerf('line_map_get', nowMs() - startedAt);
        return cached;
    }

    const buildStartedAt = nowMs();
    const built = buildLineMap(state, { tabSize });
    recordLineMapPerf('line_map_build', nowMs() - buildStartedAt);
    if (byTabSize) {
        byTabSize.set(tabSize, built);
    } else {
        lineMapCache.set(doc as object, new Map<number, LineMap>([[tabSize, built]]));
    }
    recordLineMapPerf('line_map_get', nowMs() - startedAt);
    return built;
}

export function getLineMetaAt(lineMap: LineMap, lineNumber: number): LineMeta | null {
    if (lineNumber < 1 || lineNumber >= lineMap.lineMeta.length) return null;
    return lineMap.lineMeta[lineNumber] ?? null;
}

export function getNearestListLineAtOrBefore(lineMap: LineMap, lineNumber: number): number | null {
    if (lineMap.doc.lines <= 0) return null;
    const clamped = Math.max(1, Math.min(lineMap.doc.lines, lineNumber));
    const meta = getLineMetaAt(lineMap, clamped);
    if (meta?.isList) return clamped;
    const prevListLine = lineMap.prevListLine[clamped];
    return prevListLine > 0 ? prevListLine : null;
}
