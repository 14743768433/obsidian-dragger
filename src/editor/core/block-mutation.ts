import { BlockType } from '../../types';
import { DocLike } from './protocol-types';
import { getBoundarySpacing } from './mutations/spacing-mutation';

export * from './mutations/quote-mutation';
export * from './mutations/list-mutation';
export * from './mutations/spacing-mutation';

export function buildInsertText(params: {
    doc: DocLike;
    sourceBlockType: BlockType;
    sourceContent: string;
    targetLineNumber: number;
    getBlockquoteDepthContext: (doc: DocLike, lineNumber: number) => number;
    getContentQuoteDepth: (sourceContent: string) => number;
    adjustBlockquoteDepth: (sourceContent: string, targetDepth: number, baseDepthOverride?: number) => string;
    adjustListToTargetContext: (sourceContent: string) => string;
}): string {
    const {
        doc,
        sourceBlockType,
        sourceContent,
        targetLineNumber,
        getBlockquoteDepthContext: getBlockquoteDepthContextFn,
        getContentQuoteDepth: getContentQuoteDepthFn,
        adjustBlockquoteDepth: adjustBlockquoteDepthFn,
        adjustListToTargetContext: adjustListToTargetContextFn,
    } = params;

    const prevLineNumber = Math.min(Math.max(1, targetLineNumber - 1), doc.lines);
    const prevText = targetLineNumber > 1 ? doc.line(prevLineNumber).text : null;
    const nextText = targetLineNumber <= doc.lines ? doc.line(targetLineNumber).text : null;
    const boundarySpacing = getBoundarySpacing({
        sourceBlockType,
        sourceContent,
        prevText,
        nextText,
    });

    let text = sourceContent;
    const shouldLockQuoteDepth = sourceBlockType === BlockType.CodeBlock
        || sourceBlockType === BlockType.Table
        || sourceBlockType === BlockType.MathBlock
        || sourceBlockType === BlockType.Callout
        || sourceBlockType === BlockType.Blockquote;
    if (!shouldLockQuoteDepth) {
        const targetQuoteDepth = boundarySpacing.resetQuoteDepth
            ? 0
            : getBlockquoteDepthContextFn(doc, targetLineNumber);
        const sourceQuoteDepth = getContentQuoteDepthFn(sourceContent);
        text = adjustBlockquoteDepthFn(text, targetQuoteDepth, sourceQuoteDepth);
    }

    // Quote line moves should behave like plain text moves:
    // keep source content unchanged instead of re-shaping markers/indent by target list context.
    if (sourceBlockType !== BlockType.Blockquote) {
        text = adjustListToTargetContextFn(text);
    }

    if (boundarySpacing.needsLeadingBlank) text = '\n' + text;
    const trailingNewlines = 1 + (boundarySpacing.needsTrailingBlank ? 1 : 0);
    text += '\n'.repeat(trailingNewlines);
    return text;
}
