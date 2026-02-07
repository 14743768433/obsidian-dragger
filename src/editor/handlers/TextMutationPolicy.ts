import { BlockInfo } from '../../types';
import {
    adjustBlockquoteDepth,
    adjustListToTargetContext,
    buildInsertText as buildInsertTextByPolicy,
    buildTargetMarker,
    getBlockquoteDepthContext,
    getContentQuoteDepth,
    getListContext,
} from '../core/block-mutation';
import { getBlockquoteDepthFromLine } from '../core/line-parsing';
import { DocLike, ListContext, ParsedLine } from '../core/protocol-types';
import { LineParsingService } from './LineParsingService';

export class TextMutationPolicy {
    constructor(
        private readonly lineParsingService: LineParsingService
    ) { }

    parseLineWithQuote(line: string): ParsedLine {
        return this.lineParsingService.parseLine(line);
    }

    getListContext(doc: DocLike, lineNumber: number): ListContext {
        return getListContext(doc, lineNumber, (line) => this.parseLineWithQuote(line));
    }

    getIndentUnitWidth(sample: string): number {
        return this.lineParsingService.getIndentUnitWidth(sample);
    }

    getIndentUnitWidthForDoc(doc: DocLike): number {
        return this.lineParsingService.getIndentUnitWidthForDoc(doc);
    }

    buildInsertText(
        doc: DocLike,
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        sourceContent: string,
        listContextLineNumberOverride?: number,
        listIndentDeltaOverride?: number,
        listTargetIndentWidthOverride?: number
    ): string {
        return buildInsertTextByPolicy({
            doc,
            sourceBlockType: sourceBlock.type,
            sourceContent,
            targetLineNumber,
            getBlockquoteDepthContext: (activeDoc, lineNumber) =>
                getBlockquoteDepthContext(activeDoc, lineNumber, getBlockquoteDepthFromLine),
            getContentQuoteDepth: (activeSourceContent) =>
                getContentQuoteDepth(activeSourceContent, getBlockquoteDepthFromLine),
            adjustBlockquoteDepth: (content, targetDepth, baseDepth) =>
                adjustBlockquoteDepth(content, targetDepth, getBlockquoteDepthFromLine, baseDepth),
            adjustListToTargetContext: (content) => adjustListToTargetContext({
                doc,
                sourceContent: content,
                targetLineNumber,
                parseLineWithQuote: (line) => this.parseLineWithQuote(line),
                getIndentUnitWidth: (sample) => this.getIndentUnitWidth(sample),
                buildIndentStringFromSample: (sample, width) =>
                    this.lineParsingService.buildIndentStringFromSample(sample, width),
                buildTargetMarker,
                listContextLineNumberOverride,
                listIndentDeltaOverride,
                listTargetIndentWidthOverride,
            }),
        });
    }
}
