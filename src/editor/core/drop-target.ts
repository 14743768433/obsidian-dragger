import { EditorView } from '@codemirror/view';

export interface GeometryFrameCache {
    coordsByPos: Map<number, ReturnType<EditorView['coordsAtPos']> | null>;
    lineRectByLine: Map<number, { left: number; width: number } | undefined>;
    insertionAnchorYByLine: Map<number, number | null>;
    blockRectByRange: Map<string, { top: number; left: number; width: number; height: number } | undefined>;
}

export function createGeometryFrameCache(): GeometryFrameCache {
    return {
        coordsByPos: new Map<number, ReturnType<EditorView['coordsAtPos']> | null>(),
        lineRectByLine: new Map<number, { left: number; width: number } | undefined>(),
        insertionAnchorYByLine: new Map<number, number | null>(),
        blockRectByRange: new Map<string, { top: number; left: number; width: number; height: number } | undefined>(),
    };
}

export function getCoordsAtPos(
    view: EditorView,
    pos: number,
    frameCache?: GeometryFrameCache
): ReturnType<EditorView['coordsAtPos']> | null {
    if (!frameCache) {
        return view.coordsAtPos(pos);
    }
    if (frameCache.coordsByPos.has(pos)) {
        return frameCache.coordsByPos.get(pos) ?? null;
    }
    const coords = view.coordsAtPos(pos);
    frameCache.coordsByPos.set(pos, coords);
    return coords;
}

export function getLineRect(
    view: EditorView,
    lineNumber: number,
    frameCache?: GeometryFrameCache
): { left: number; width: number } | undefined {
    const doc = view.state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return undefined;
    if (frameCache && frameCache.lineRectByLine.has(lineNumber)) {
        return frameCache.lineRectByLine.get(lineNumber);
    }
    const line = doc.line(lineNumber);
    const start = getCoordsAtPos(view, line.from, frameCache);
    const end = getCoordsAtPos(view, line.to, frameCache);
    if (!start || !end) {
        if (frameCache) frameCache.lineRectByLine.set(lineNumber, undefined);
        return undefined;
    }
    const left = Math.min(start.left, end.left);
    const right = Math.max(start.left, end.left);
    const rect = { left, width: Math.max(8, right - left) };
    if (frameCache) frameCache.lineRectByLine.set(lineNumber, rect);
    return rect;
}

export function getInsertionAnchorY(
    view: EditorView,
    lineNumber: number,
    frameCache?: GeometryFrameCache
): number | null {
    const doc = view.state.doc;
    if (frameCache && frameCache.insertionAnchorYByLine.has(lineNumber)) {
        return frameCache.insertionAnchorYByLine.get(lineNumber) ?? null;
    }
    let y: number | null = null;
    if (lineNumber <= 1) {
        const first = doc.line(1);
        const coords = getCoordsAtPos(view, first.from, frameCache);
        y = coords ? coords.top : null;
    } else {
        const anchorLineNumber = Math.min(lineNumber - 1, doc.lines);
        const anchorLine = doc.line(anchorLineNumber);
        const coords = getCoordsAtPos(view, anchorLine.to, frameCache);
        y = coords ? coords.bottom : null;
    }
    if (frameCache) frameCache.insertionAnchorYByLine.set(lineNumber, y);
    return y;
}

export function getLineIndentPosByWidth(
    view: EditorView,
    lineNumber: number,
    targetIndentWidth: number,
    tabSize: number
): number | null {
    const doc = view.state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const line = doc.line(lineNumber);
    const text = line.text;
    let width = 0;
    let idx = 0;
    while (idx < text.length && width < targetIndentWidth) {
        const ch = text[idx];
        if (ch === '\t') {
            width += tabSize;
        } else if (ch === ' ') {
            width += 1;
        } else {
            break;
        }
        idx += 1;
    }
    return line.from + idx;
}

export function getBlockRect(
    view: EditorView,
    startLineNumber: number,
    endLineNumber: number,
    frameCache?: GeometryFrameCache
): { top: number; left: number; width: number; height: number } | undefined {
    const doc = view.state.doc;
    if (startLineNumber < 1 || endLineNumber > doc.lines) return undefined;
    const cacheKey = `${startLineNumber}:${endLineNumber}`;
    if (frameCache && frameCache.blockRectByRange.has(cacheKey)) {
        return frameCache.blockRectByRange.get(cacheKey);
    }
    let minLeft = Number.POSITIVE_INFINITY;
    let maxRight = 0;
    let top = 0;
    let bottom = 0;

    for (let i = startLineNumber; i <= endLineNumber; i++) {
        const line = doc.line(i);
        const start = getCoordsAtPos(view, line.from, frameCache);
        const end = getCoordsAtPos(view, line.to, frameCache);
        if (!start || !end) continue;
        if (i === startLineNumber) top = start.top;
        if (i === endLineNumber) bottom = end.bottom;
        const left = Math.min(start.left, end.left);
        const right = Math.max(start.left, end.left);
        minLeft = Math.min(minLeft, left);
        maxRight = Math.max(maxRight, right);
    }

    if (!isFinite(minLeft) || maxRight === 0 || bottom <= top) {
        if (frameCache) frameCache.blockRectByRange.set(cacheKey, undefined);
        return undefined;
    }
    const rect = { top, left: minLeft, width: Math.max(8, maxRight - minLeft), height: bottom - top };
    if (frameCache) frameCache.blockRectByRange.set(cacheKey, rect);
    return rect;
}
