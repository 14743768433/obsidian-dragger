import { BlockType } from '../../types';
import {
    isBlockquoteLine,
    isCalloutLine,
    isHorizontalRuleLine,
    isListItemLine,
    isTableLine,
} from './line-type-guards';

export type InsertionSlotContext =
    | 'inside_list'
    | 'inside_quote_run'
    | 'quote_before'
    | 'quote_after'
    | 'callout_after'
    | 'table_before'
    | 'hr_before'
    | 'outside';

export type InsertionRuleRejectReason =
    | 'inside_list'
    | 'inside_quote_run'
    | 'quote_boundary'
    | 'callout_after'
    | 'table_before'
    | 'hr_before';

export interface InsertionRuleInput {
    sourceType: BlockType;
    slotContext: InsertionSlotContext;
}

export interface InsertionRuleDecision {
    allowDrop: boolean;
    rejectReason: InsertionRuleRejectReason | null;
}

type RuleKey = `${BlockType}|${InsertionSlotContext}`;

const ALL_TYPES = Object.values(BlockType) as BlockType[];

function rejectEntries(
    types: BlockType[],
    slot: InsertionSlotContext,
    reason: InsertionRuleRejectReason
): [RuleKey, InsertionRuleRejectReason][] {
    return types.map((t): [RuleKey, InsertionRuleRejectReason] => [`${t}|${slot}`, reason]);
}

const REJECT_RULES: ReadonlyMap<RuleKey, InsertionRuleRejectReason> = new Map<RuleKey, InsertionRuleRejectReason>([
    // inside_list: only ListItem allowed
    ...rejectEntries(
        ALL_TYPES.filter((t) => t !== BlockType.ListItem),
        'inside_list',
        'inside_list'
    ),

    // inside_quote_run: only Blockquote allowed (not Callout)
    ...rejectEntries(
        ALL_TYPES.filter((t) => t !== BlockType.Blockquote),
        'inside_quote_run',
        'inside_quote_run'
    ),

    // quote_before: Callout blocked
    ...rejectEntries([BlockType.Callout], 'quote_before', 'quote_boundary'),

    // quote_after: only Blockquote allowed
    ...rejectEntries(
        ALL_TYPES.filter((t) => t !== BlockType.Blockquote),
        'quote_after',
        'quote_boundary'
    ),

    // callout_after, table_before, hr_before: block ALL source types
    ...rejectEntries(ALL_TYPES, 'callout_after', 'callout_after'),
    ...rejectEntries(ALL_TYPES, 'table_before', 'table_before'),
    ...rejectEntries(ALL_TYPES, 'hr_before', 'hr_before'),
]);

export function inferSlotContextFromAdjacentLines(input: {
    prevText: string | null;
    nextText: string | null;
}): InsertionSlotContext {
    const { prevText, nextText } = input;
    const prevIsQuoteLike = isBlockquoteLine(prevText);
    const nextIsQuoteLike = isBlockquoteLine(nextText);

    if (isCalloutLine(prevText) && !nextIsQuoteLike) {
        return 'callout_after';
    }

    const nextIsTable = isTableLine(nextText);
    const prevIsTable = isTableLine(prevText);
    if (nextIsTable && !prevIsTable) {
        return 'table_before';
    }

    if (isHorizontalRuleLine(nextText)) {
        return 'hr_before';
    }

    if (prevIsQuoteLike && nextIsQuoteLike) {
        return 'inside_quote_run';
    }
    if (!prevIsQuoteLike && nextIsQuoteLike) {
        return 'quote_before';
    }
    if (prevIsQuoteLike && !nextIsQuoteLike) {
        return 'quote_after';
    }

    if (isListItemLine(prevText) && isListItemLine(nextText)) {
        return 'inside_list';
    }

    return 'outside';
}

export function resolveInsertionRule(input: InsertionRuleInput): InsertionRuleDecision {
    const key: RuleKey = `${input.sourceType}|${input.slotContext}`;
    const rejectReason = REJECT_RULES.get(key) ?? null;
    return {
        allowDrop: rejectReason === null,
        rejectReason,
    };
}
