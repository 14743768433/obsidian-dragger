import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { validateInPlaceDrop } from '../core/drop-validation';
import { getLineMap, LineMap } from '../core/line-map';
import { InsertionSlotContext } from '../core/insertion-rule-matrix';
import { DocLike, DocLikeWithRange, ListContext, ParsedLine } from '../core/protocol-types';
import { ListRenumberer } from './ListRenumberer';
import { clampTargetLineNumber } from '../utils/coordinate-utils';

export interface BlockMoverDeps {
    view: EditorView;
    getAdjustedTargetLocation: (lineNumber: number, options?: { clientY?: number }) => { lineNumber: number; blockAdjusted: boolean };
    resolveDropRuleAtInsertion: (
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        options?: { lineMap?: LineMap }
    ) => {
        slotContext: InsertionSlotContext;
        decision: { allowDrop: boolean; rejectReason?: string | null };
    };
    parseLineWithQuote: (line: string) => ParsedLine;
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    buildInsertText: (
        doc: DocLike,
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        sourceContent: string,
        listContextLineNumberOverride?: number,
        listIndentDeltaOverride?: number,
        listTargetIndentWidthOverride?: number
    ) => string;
}

export class BlockMover {
    private readonly listRenumberer: ListRenumberer;

    constructor(private readonly deps: BlockMoverDeps) {
        this.listRenumberer = new ListRenumberer({
            view: deps.view,
            parseLineWithQuote: deps.parseLineWithQuote,
        });
    }

    moveBlock(params: {
        sourceBlock: BlockInfo;
        targetPos: number;
        targetLineNumberOverride?: number;
        listContextLineNumberOverride?: number;
        listIndentDeltaOverride?: number;
        listTargetIndentWidthOverride?: number;
    }): void {
        const {
            sourceBlock,
            targetPos,
            targetLineNumberOverride,
            listContextLineNumberOverride,
            listIndentDeltaOverride,
            listTargetIndentWidthOverride,
        } = params;

        const compositeRanges = sourceBlock.compositeSelection?.ranges ?? [];
        if (compositeRanges.length > 1) {
            this.moveCompositeBlock(params);
            return;
        }

        const view = this.deps.view;
        const doc = view.state.doc as unknown as DocLikeWithRange;
        const targetLine = view.state.doc.lineAt(targetPos);

        let targetLineNumber = targetLineNumberOverride ?? targetLine.number;

        if (targetLineNumberOverride === undefined) {
            const adjusted = this.deps.getAdjustedTargetLocation(targetLine.number);
            if (adjusted.blockAdjusted) {
                targetLineNumber = adjusted.lineNumber;
            }
        }

        targetLineNumber = clampTargetLineNumber(doc.lines, targetLineNumber);
        const lineMap = getLineMap(view.state);
        const containerRule = this.deps.resolveDropRuleAtInsertion(
            sourceBlock,
            targetLineNumber,
            { lineMap }
        );
        if (!containerRule.decision.allowDrop) {
            return;
        }

        const inPlaceValidation = validateInPlaceDrop({
            doc,
            sourceBlock,
            targetLineNumber,
            parseLineWithQuote: this.deps.parseLineWithQuote,
            getListContext: this.deps.getListContext,
            getIndentUnitWidth: this.deps.getIndentUnitWidth,
            slotContext: containerRule.slotContext,
            lineMap,
            listContextLineNumberOverride,
            listIndentDeltaOverride,
            listTargetIndentWidthOverride,
        });
        const allowInPlaceIndentChange = inPlaceValidation.allowInPlaceIndentChange;
        if (inPlaceValidation.inSelfRange && !allowInPlaceIndentChange) {
            return;
        }

        const sourceStartLine = doc.line(sourceBlock.startLine + 1);
        const sourceEndLine = doc.line(sourceBlock.endLine + 1);
        const sourceFrom = sourceStartLine.from;
        const sourceTo = sourceEndLine.to;
        const sourceContent = doc.sliceString(sourceFrom, sourceTo);
        const insertText = this.deps.buildInsertText(
            doc,
            sourceBlock,
            targetLineNumber,
            sourceContent,
            listContextLineNumberOverride,
            listIndentDeltaOverride,
            listTargetIndentWidthOverride
        );

        const insertPos = targetLineNumber > doc.lines
            ? doc.length
            : doc.line(targetLineNumber).from;
        const deleteFrom = sourceFrom;
        const deleteTo = Math.min(sourceTo + 1, doc.length);

        if (allowInPlaceIndentChange && insertPos === deleteFrom) {
            view.dispatch({
                changes: { from: deleteFrom, to: deleteTo, insert: insertText },
                scrollIntoView: false,
            });
        } else {
            view.dispatch({
                changes: [
                    { from: insertPos, to: insertPos, insert: insertText },
                    { from: deleteFrom, to: deleteTo },
                ].sort((a, b) => b.from - a.from),
                scrollIntoView: false,
            });
        }

        const sourceLineNumber = sourceBlock.startLine + 1;
        setTimeout(() => {
            this.listRenumberer.renumberOrderedListAround(sourceLineNumber);
            this.listRenumberer.renumberOrderedListAround(targetLineNumber);
        }, 0);
    }

    private moveCompositeBlock(params: {
        sourceBlock: BlockInfo;
        targetPos: number;
        targetLineNumberOverride?: number;
        listContextLineNumberOverride?: number;
        listIndentDeltaOverride?: number;
        listTargetIndentWidthOverride?: number;
    }): void {
        const { sourceBlock, targetPos, targetLineNumberOverride } = params;
        const view = this.deps.view;
        const doc = view.state.doc as unknown as DocLikeWithRange;
        const normalizedRanges = this.normalizeCompositeRanges(
            sourceBlock.compositeSelection?.ranges ?? [],
            doc.lines
        );
        if (normalizedRanges.length <= 1) {
            return;
        }

        const targetLine = view.state.doc.lineAt(targetPos);
        let targetLineNumber = targetLineNumberOverride ?? targetLine.number;
        if (targetLineNumberOverride === undefined) {
            const adjusted = this.deps.getAdjustedTargetLocation(targetLine.number);
            if (adjusted.blockAdjusted) {
                targetLineNumber = adjusted.lineNumber;
            }
        }
        targetLineNumber = clampTargetLineNumber(doc.lines, targetLineNumber);

        const lineMap = getLineMap(view.state);
        const containerRule = this.deps.resolveDropRuleAtInsertion(
            sourceBlock,
            targetLineNumber,
            { lineMap }
        );
        if (!containerRule.decision.allowDrop) {
            return;
        }
        if (this.isTargetInsideCompositeRanges(targetLineNumber, normalizedRanges)) {
            return;
        }

        const segments = normalizedRanges.map((range) => {
            const startLine = doc.line(range.startLine + 1);
            const endLine = doc.line(range.endLine + 1);
            const from = startLine.from;
            const to = Math.min(endLine.to + 1, doc.length);
            return {
                from,
                to,
                startLineNumber: range.startLine + 1,
            };
        });

        const insertText = segments
            .map((segment) => doc.sliceString(segment.from, segment.to))
            .join('');
        if (!insertText.length) return;

        const insertPos = targetLineNumber > doc.lines
            ? doc.length
            : doc.line(targetLineNumber).from;
        if (segments.some((segment) => insertPos > segment.from && insertPos < segment.to)) {
            return;
        }

        const changes = [
            { from: insertPos, to: insertPos, insert: insertText },
            ...segments.map((segment) => ({ from: segment.from, to: segment.to })),
        ].sort((a, b) => b.from - a.from);

        view.dispatch({
            changes,
            scrollIntoView: false,
        });

        const renumberTargets = new Set<number>([targetLineNumber]);
        for (const segment of segments) {
            renumberTargets.add(segment.startLineNumber);
        }
        setTimeout(() => {
            for (const lineNumber of renumberTargets) {
                this.listRenumberer.renumberOrderedListAround(lineNumber);
            }
        }, 0);
    }

    private normalizeCompositeRanges(
        ranges: Array<{ startLine: number; endLine: number }>,
        totalLines: number
    ): Array<{ startLine: number; endLine: number }> {
        const normalized = ranges
            .map((range) => {
                const startLine = Math.max(0, Math.min(totalLines - 1, Math.min(range.startLine, range.endLine)));
                const endLine = Math.max(0, Math.min(totalLines - 1, Math.max(range.startLine, range.endLine)));
                return { startLine, endLine };
            })
            .sort((a, b) => a.startLine - b.startLine);

        const merged: Array<{ startLine: number; endLine: number }> = [];
        for (const range of normalized) {
            const last = merged[merged.length - 1];
            if (!last || range.startLine > last.endLine + 1) {
                merged.push(range);
            } else if (range.endLine > last.endLine) {
                last.endLine = range.endLine;
            }
        }
        return merged;
    }

    private isTargetInsideCompositeRanges(
        targetLineNumber: number,
        ranges: Array<{ startLine: number; endLine: number }>
    ): boolean {
        const targetLine0 = targetLineNumber - 1;
        for (const range of ranges) {
            if (targetLine0 >= range.startLine && targetLine0 <= range.endLine) {
                return true;
            }
        }
        return false;
    }
}
