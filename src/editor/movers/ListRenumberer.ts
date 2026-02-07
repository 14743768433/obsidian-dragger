import { EditorView } from '@codemirror/view';
import { ParsedLine } from '../core/types';

export interface ListRenumbererDeps {
    view: EditorView;
    parseLineWithQuote: (line: string) => ParsedLine;
}

export class ListRenumberer {
    constructor(private readonly deps: ListRenumbererDeps) { }

    renumberOrderedListAround(lineNumber: number): void {
        const view = this.deps.view;
        const doc = view.state.doc;
        if (lineNumber < 1 || lineNumber > doc.lines) return;

        const findOrderedAt = (n: number) => {
            const text = doc.line(n).text;
            const parsed = this.deps.parseLineWithQuote(text);
            if (parsed.isListItem && parsed.markerType === 'ordered') {
                return { indentWidth: parsed.indentWidth, quoteDepth: parsed.quoteDepth };
            }
            return null;
        };

        let anchor = findOrderedAt(lineNumber);
        if (!anchor && lineNumber > 1) anchor = findOrderedAt(lineNumber - 1);
        if (!anchor && lineNumber < doc.lines) anchor = findOrderedAt(lineNumber + 1);
        if (!anchor) return;

        let start = lineNumber;
        while (start > 1) {
            const info = findOrderedAt(start - 1);
            if (!info || info.indentWidth !== anchor.indentWidth || info.quoteDepth !== anchor.quoteDepth) break;
            start -= 1;
        }

        let end = lineNumber;
        while (end < doc.lines) {
            const info = findOrderedAt(end + 1);
            if (!info || info.indentWidth !== anchor.indentWidth || info.quoteDepth !== anchor.quoteDepth) break;
            end += 1;
        }

        const changes: { from: number; to: number; insert: string }[] = [];
        let number = 1;
        for (let i = start; i <= end; i++) {
            const line = doc.line(i);
            const parsed = this.deps.parseLineWithQuote(line.text);
            if (!parsed.isListItem || parsed.markerType !== 'ordered' || parsed.indentWidth !== anchor.indentWidth) continue;

            const newMarker = `${number}. `;
            const markerStart = line.from + parsed.quotePrefix.length + parsed.indentRaw.length;
            const markerEnd = markerStart + parsed.marker.length;
            changes.push({ from: markerStart, to: markerEnd, insert: newMarker });
            number += 1;
        }

        if (changes.length > 0) {
            view.dispatch({ changes });
        }
    }
}
