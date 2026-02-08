import { BlockInfo } from '../../types';
import {
    InsertionRuleRejectReason,
    InsertionSlotContext,
    resolveInsertionRule,
} from './insertion-rule-matrix';
import { computeListIndentPlan } from './mutations/list-mutation';
import { DocLike, ListContext, ParsedLine } from './protocol-types';

export type InPlaceDropRejectReason =
    | 'self_range_blocked'
    | 'self_embedding'
    | 'container_policy'
    | InsertionRuleRejectReason;

export type InPlaceDropValidationResult = {
    inSelfRange: boolean;
    allowInPlaceIndentChange: boolean;
    rejectReason?: InPlaceDropRejectReason;
    listContextLineNumber?: number;
    targetIndentWidth?: number;
};

export function validateInPlaceDrop(params: {
    doc: DocLike;
    sourceBlock: BlockInfo;
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    slotContext?: InsertionSlotContext;
    listContextLineNumberOverride?: number;
    listIndentDeltaOverride?: number;
    listTargetIndentWidthOverride?: number;
}): InPlaceDropValidationResult {
    const {
        doc,
        sourceBlock,
        targetLineNumber,
        parseLineWithQuote,
        getListContext,
        getIndentUnitWidth,
        slotContext,
        listContextLineNumberOverride,
        listIndentDeltaOverride,
        listTargetIndentWidthOverride,
    } = params;

    if (typeof slotContext === 'string') {
        const containerRule = resolveInsertionRule({
            sourceType: sourceBlock.type,
            slotContext,
        });
        if (!containerRule.allowDrop) {
            return {
                inSelfRange: false,
                allowInPlaceIndentChange: false,
                rejectReason: containerRule.rejectReason ?? 'container_policy',
            };
        }
    }

    const targetLineIdx = targetLineNumber - 1;
    const inSelfRange = targetLineIdx >= sourceBlock.startLine && targetLineIdx <= sourceBlock.endLine + 1;
    if (!inSelfRange) {
        return { inSelfRange: false, allowInPlaceIndentChange: false };
    }

    const hasListIntent = listTargetIndentWidthOverride !== undefined || listIndentDeltaOverride !== undefined;
    if (!hasListIntent) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const sourceLineNumber = sourceBlock.startLine + 1;
    const sourceLineText = doc.line(sourceLineNumber).text;
    const sourceParsed = parseLineWithQuote(sourceLineText);
    if (!sourceParsed.isListItem) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const indentPlan = computeListIndentPlan({
        doc,
        sourceBase: {
            indentWidth: sourceParsed.indentWidth,
            indentRaw: sourceParsed.indentRaw,
        },
        targetLineNumber,
        parseLineWithQuote,
        getIndentUnitWidth,
        getListContext,
        listContextLineNumberOverride,
        listIndentDeltaOverride,
        listTargetIndentWidthOverride,
    });
    const targetIndentWidth = indentPlan.targetIndentWidth;
    const listContextLineNumber = indentPlan.listContextLineNumber;

    const isAfterSelf = targetLineIdx === sourceBlock.endLine + 1;
    const isSameLine = targetLineIdx === sourceBlock.startLine;
    const sourceEndLineNumber = sourceBlock.endLine + 1;
    const isSelfContext = listContextLineNumber === sourceLineNumber;
    const isContextInsideSource = listContextLineNumber >= sourceLineNumber
        && listContextLineNumber <= sourceEndLineNumber;

    if (isAfterSelf && isContextInsideSource && targetIndentWidth > sourceParsed.indentWidth) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_embedding',
            listContextLineNumber,
            targetIndentWidth,
        };
    }

    const allowInPlaceIndentChange = (
        (isAfterSelf && targetIndentWidth !== sourceParsed.indentWidth)
        || (isSameLine && targetIndentWidth !== sourceParsed.indentWidth && !isSelfContext)
        || (!isAfterSelf && targetIndentWidth < sourceParsed.indentWidth)
    );

    if (!allowInPlaceIndentChange) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
            listContextLineNumber,
            targetIndentWidth,
        };
    }

    return {
        inSelfRange: true,
        allowInPlaceIndentChange,
        listContextLineNumber,
        targetIndentWidth,
    };
}
