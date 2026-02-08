import { BlockInfo, BlockType } from '../../types';
import { detectBlock } from '../block-detector';
import {
    InsertionRuleDecision,
    InsertionSlotContext,
    resolveInsertionRule,
} from './insertion-rule-matrix';
import { DocLike, StateWithDoc } from './protocol-types';

type ContainerType = BlockType.ListItem | BlockType.Blockquote | BlockType.Callout;
export type DetectBlockFn = (state: StateWithDoc, lineNumber: number) => BlockInfo | null;

export interface DropRuleContext {
    slotContext: InsertionSlotContext;
    decision: InsertionRuleDecision;
}

function clampInsertionLineNumber(doc: DocLike, lineNumber: number): number {
    if (lineNumber < 1) return 1;
    if (lineNumber > doc.lines + 1) return doc.lines + 1;
    return lineNumber;
}

function isBlockquoteLine(text: string | null): boolean {
    if (!text) return false;
    return /^(> ?)+/.test(text.trimStart());
}

function isHorizontalRuleLine(text: string | null): boolean {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length < 3) return false;
    return /^([-*_])(?:\s*\1){2,}$/.test(trimmed);
}

function getImmediateLineText(doc: DocLike, lineNumber: number): string | null {
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    return doc.line(lineNumber).text;
}

export function getPreviousNonEmptyLineNumber(doc: DocLike, lineNumber: number): number | null {
    for (let i = lineNumber; i >= 1; i--) {
        const text = doc.line(i).text;
        if (text.trim().length === 0) continue;
        return i;
    }
    return null;
}

export function getNextNonEmptyLineNumber(doc: DocLike, lineNumber: number): number | null {
    for (let i = lineNumber; i <= doc.lines; i++) {
        const text = doc.line(i).text;
        if (text.trim().length === 0) continue;
        return i;
    }
    return null;
}

export function findEnclosingListBlock(
    state: StateWithDoc,
    lineNumber: number,
    detectBlockFn: DetectBlockFn = detectBlock as unknown as DetectBlockFn
): BlockInfo | null {
    const doc = state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return null;

    const radius = 8;
    const minLine = Math.max(1, lineNumber - radius);
    const maxLine = Math.min(doc.lines, lineNumber + radius);
    let best: BlockInfo | null = null;

    for (let ln = minLine; ln <= maxLine; ln++) {
        const block = detectBlockFn(state, ln);
        if (!block || block.type !== BlockType.ListItem) continue;
        const blockStart = block.startLine + 1;
        const blockEnd = block.endLine + 1;
        if (lineNumber < blockStart || lineNumber > blockEnd) continue;

        if (!best || (block.endLine - block.startLine) > (best.endLine - best.startLine)) {
            best = block;
        }
    }

    return best;
}

function isTableBlockStartAtLine(
    state: StateWithDoc,
    lineNumber: number,
    detectBlockFn: DetectBlockFn
): boolean {
    if (lineNumber < 1 || lineNumber > state.doc.lines) return false;
    const block = detectBlockFn(state, lineNumber);
    return !!block && block.type === BlockType.Table && block.startLine + 1 === lineNumber;
}

function isHorizontalRuleAtLine(
    state: StateWithDoc,
    lineNumber: number,
    detectBlockFn: DetectBlockFn
): boolean {
    if (lineNumber < 1 || lineNumber > state.doc.lines) return false;
    const block = detectBlockFn(state, lineNumber);
    if (block) {
        return block.type === BlockType.HorizontalRule && block.startLine + 1 === lineNumber;
    }
    return isHorizontalRuleLine(state.doc.line(lineNumber).text);
}

function isCalloutAfterBoundary(
    state: StateWithDoc,
    prevImmediateLine: number,
    nextIsQuoteLike: boolean,
    detectBlockFn: DetectBlockFn
): boolean {
    if (prevImmediateLine < 1 || prevImmediateLine > state.doc.lines) return false;
    if (nextIsQuoteLike) return false;
    const prevBlock = detectBlockFn(state, prevImmediateLine);
    return !!prevBlock
        && prevBlock.type === BlockType.Callout
        && prevBlock.endLine + 1 === prevImmediateLine;
}

function resolveListContextAtInsertion(
    state: StateWithDoc,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn
): { type: ContainerType; block: BlockInfo } | null {
    const doc = state.doc;
    if (doc.lines <= 0) return null;

    const candidates = [
        targetLineNumber - 1,
        targetLineNumber,
        targetLineNumber + 1,
        getPreviousNonEmptyLineNumber(doc, targetLineNumber - 1),
        getNextNonEmptyLineNumber(doc, targetLineNumber),
    ].filter((v): v is number => typeof v === 'number' && v >= 1 && v <= doc.lines);
    const seen = new Set<number>();
    let best: BlockInfo | null = null;

    for (const lineNumber of candidates) {
        if (seen.has(lineNumber)) continue;
        seen.add(lineNumber);
        const block = findEnclosingListBlock(state, lineNumber, detectBlockFn);
        if (!block) continue;

        const blockTopBoundary = block.startLine + 1;
        const blockBottomBoundary = block.endLine + 2;
        const isInsideContainer = targetLineNumber > blockTopBoundary
            && targetLineNumber < blockBottomBoundary;
        if (!isInsideContainer) continue;

        if (!best || (block.endLine - block.startLine) > (best.endLine - best.startLine)) {
            best = block;
        }
    }

    if (!best) return null;
    return { type: BlockType.ListItem, block: best };
}

export function getContainerContextAtInsertion(
    state: StateWithDoc,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn = detectBlock as unknown as DetectBlockFn
): { type: ContainerType; block: BlockInfo } | null {
    const doc = state.doc;
    const clampedTarget = clampInsertionLineNumber(doc, targetLineNumber);
    return resolveListContextAtInsertion(state, clampedTarget, detectBlockFn);
}

export function resolveSlotContextAtInsertion(
    state: StateWithDoc,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn = detectBlock as unknown as DetectBlockFn
): InsertionSlotContext {
    const doc = state.doc;
    const clampedTarget = clampInsertionLineNumber(doc, targetLineNumber);
    const prevImmediateLine = clampedTarget - 1;
    const nextImmediateLine = clampedTarget <= doc.lines ? clampedTarget : null;
    const prevImmediateText = getImmediateLineText(doc, prevImmediateLine);
    const nextImmediateText = nextImmediateLine === null ? null : getImmediateLineText(doc, nextImmediateLine);
    const prevIsQuoteLike = isBlockquoteLine(prevImmediateText);
    const nextIsQuoteLike = isBlockquoteLine(nextImmediateText);

    if (isCalloutAfterBoundary(state, prevImmediateLine, nextIsQuoteLike, detectBlockFn)) {
        return 'callout_after';
    }

    if (nextImmediateLine !== null && isTableBlockStartAtLine(state, nextImmediateLine, detectBlockFn)) {
        return 'table_before';
    }

    if (nextImmediateLine !== null && isHorizontalRuleAtLine(state, nextImmediateLine, detectBlockFn)) {
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

    const listContext = resolveListContextAtInsertion(state, clampedTarget, detectBlockFn);
    if (listContext) {
        return 'inside_list';
    }

    return 'outside';
}

export function shouldPreventDropIntoDifferentContainer(
    state: StateWithDoc,
    sourceBlock: BlockInfo,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn = detectBlock as unknown as DetectBlockFn
): boolean {
    const ruleContext = resolveDropRuleContextAtInsertion(
        state,
        sourceBlock,
        targetLineNumber,
        detectBlockFn
    );
    return !ruleContext.decision.allowDrop;
}

export function resolveDropRuleContextAtInsertion(
    state: StateWithDoc,
    sourceBlock: BlockInfo,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn = detectBlock as unknown as DetectBlockFn
): DropRuleContext {
    const slotContext = resolveSlotContextAtInsertion(state, targetLineNumber, detectBlockFn);
    const decision = resolveInsertionRule({
        sourceType: sourceBlock.type,
        slotContext,
    });
    return {
        slotContext,
        decision,
    };
}
