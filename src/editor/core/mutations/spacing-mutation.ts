import { BlockType } from '../../../types';

export function shouldSeparateBlock(type: BlockType, adjacentLineText: string | null): boolean {
    if (!adjacentLineText) return false;
    if (adjacentLineText.trim().length === 0) return false;

    const trimmed = adjacentLineText.trimStart();
    if (type === BlockType.Blockquote) {
        return false;
    }
    if (type === BlockType.Table) {
        return trimmed.startsWith('|');
    }

    return false;
}

function isBlockquoteLikeLine(line: string | null): boolean {
    if (!line) return false;
    return /^(> ?)+/.test(line.trimStart());
}

function isTableRowLine(line: string | null): boolean {
    if (!line) return false;
    return line.trimStart().startsWith('|');
}

function getFirstNonEmptyLine(content: string): string | null {
    const lines = content.split('\n');
    for (const line of lines) {
        if (line.trim().length === 0) continue;
        return line;
    }
    return null;
}

export function getBoundarySpacing(params: {
    sourceBlockType: BlockType;
    sourceContent: string;
    prevText: string | null;
    nextText: string | null;
}): {
    needsLeadingBlank: boolean;
    needsTrailingBlank: boolean;
    resetQuoteDepth: boolean;
} {
    const { sourceBlockType, sourceContent, prevText, nextText } = params;
    const firstNonEmptySourceLine = getFirstNonEmptyLine(sourceContent);
    const sourceIsQuoteLike = sourceBlockType === BlockType.Blockquote
        || sourceBlockType === BlockType.Callout
        || isBlockquoteLikeLine(firstNonEmptySourceLine);
    const prevIsQuoteLike = isBlockquoteLikeLine(prevText);

    const resetQuoteDepth = prevIsQuoteLike && !sourceIsQuoteLike;

    return {
        needsLeadingBlank: resetQuoteDepth,
        needsTrailingBlank: isTableRowLine(nextText),
        resetQuoteDepth,
    };
}
