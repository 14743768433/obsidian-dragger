import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { buildInsertText as buildInsertTextByPolicy } from '../core/block-mutation';
import { DocLike, ListContext, ParsedLine } from '../core/types';
import {
    adjustBlockquoteDepth,
    getBlockquoteDepthContext,
    getContentQuoteDepth,
} from '../utils/blockquote-utils';
import {
    adjustListToTargetContext,
    buildTargetMarker,
    getListContext,
} from '../utils/list-utils';
import { LineParser } from './LineParser';

export class TextMutationPolicy {
    constructor(
        private readonly view: EditorView,
        private readonly lineParser: LineParser
    ) { }

    parseLineWithQuote(line: string): ParsedLine {
        return this.lineParser.parseLine(line);
    }

    getListContext(doc: DocLike, lineNumber: number): ListContext {
        return getListContext(doc, lineNumber, (line) => this.parseLineWithQuote(line));
    }

    getIndentUnitWidth(sample: string): number {
        return this.lineParser.getIndentUnitWidth(sample);
    }

    getIndentUnitWidthForDoc(doc: DocLike): number {
        return this.lineParser.getIndentUnitWidthForDoc(doc, this.view.state);
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
            getBlockquoteDepthContext,
            getContentQuoteDepth,
            adjustBlockquoteDepth: (content, targetDepth, baseDepth) =>
                adjustBlockquoteDepth(content, targetDepth, baseDepth),
            adjustListToTargetContext: (content) => adjustListToTargetContext({
                doc,
                sourceContent: content,
                targetLineNumber,
                parseLineWithQuote: (line) => this.parseLineWithQuote(line),
                getIndentUnitWidth: (sample) => this.getIndentUnitWidth(sample),
                buildIndentStringFromSample: (sample, width) =>
                    this.lineParser.buildIndentStringFromSample(sample, width, this.view.state),
                buildTargetMarker,
                listContextLineNumberOverride,
                listIndentDeltaOverride,
                listTargetIndentWidthOverride,
            }),
        });
    }
}
