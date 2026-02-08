import { BlockType } from '../../../types';

export function shouldSeparateBlock(type: BlockType, adjacentLineText: string | null): boolean {
    if (!adjacentLineText) return false;
    if (adjacentLineText.trim().length === 0) return false;

    const trimmed = adjacentLineText.trimStart();
    if (trimmed.startsWith('|')) {
        // Keep quote/callout flows compact, but separate normal/table blocks from table rows.
        if (type === BlockType.Blockquote || type === BlockType.Callout) return false;
        return trimmed.startsWith('|');
    }

    return false;
}

function isBlockquoteLikeLine(line: string | null): boolean {
    if (!line) return false;
    return /^(> ?)+/.test(line.trimStart());
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
    const nextIsQuoteLike = isBlockquoteLikeLine(nextText);

    // Quote depth should reset only when insertion actually leaves the quote flow.
    const resetQuoteDepth = prevIsQuoteLike && !nextIsQuoteLike && !sourceIsQuoteLike;

    return {
        needsLeadingBlank: resetQuoteDepth,
        needsTrailingBlank: shouldSeparateBlock(sourceBlockType, nextText),
        resetQuoteDepth,
    };
}
