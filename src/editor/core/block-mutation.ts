import { BlockType } from '../../types';

export * from './mutations/quote-mutation';
export * from './mutations/list-mutation';

export function buildInsertText(params: {
    sourceBlockType: BlockType;
    sourceContent: string;
    adjustListToTargetContext: (sourceContent: string) => string;
}): string {
    const {
        sourceBlockType,
        sourceContent,
        adjustListToTargetContext: adjustListToTargetContextFn,
    } = params;

    let text = sourceContent;

    // Quote line moves should behave like plain text moves:
    // keep source content unchanged instead of re-shaping markers/indent by target list context.
    if (sourceBlockType !== BlockType.Blockquote) {
        text = adjustListToTargetContextFn(text);
    }

    text += '\n';
    return text;
}
