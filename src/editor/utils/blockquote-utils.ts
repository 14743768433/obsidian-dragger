import {
    adjustBlockquoteDepth as adjustBlockquoteDepthText,
    getBlockquoteDepthContext as getBlockquoteDepthContextFromDoc,
    getContentQuoteDepth as getContentQuoteDepthFromContent,
} from '../core/block-mutation';
import { DocLike } from '../core/types';
import { getBlockquoteDepthFromLine as getBlockquoteDepthFromLineText } from '../core/line-parser';

export function getBlockquoteDepthFromLine(line: string): number {
    return getBlockquoteDepthFromLineText(line);
}

export function getBlockquoteDepthContext(doc: DocLike, lineNumber: number): number {
    return getBlockquoteDepthContextFromDoc(doc, lineNumber, getBlockquoteDepthFromLine);
}

export function getContentQuoteDepth(sourceContent: string): number {
    return getContentQuoteDepthFromContent(sourceContent, getBlockquoteDepthFromLine);
}

export function adjustBlockquoteDepth(sourceContent: string, targetDepth: number, baseDepthOverride?: number): string {
    return adjustBlockquoteDepthText(
        sourceContent,
        targetDepth,
        getBlockquoteDepthFromLine,
        baseDepthOverride
    );
}
