import { EditorView } from '@codemirror/view';
import { detectBlock } from '../block-detector';
import { BlockInfo } from '../../types';
import { shouldPreventDropIntoDifferentContainer as shouldPreventDropIntoContainer } from '../core/container-policy';

export class ContainerDropPolicy {
    constructor(private readonly view: EditorView) { }

    shouldPreventDropIntoDifferentContainer(
        sourceBlock: BlockInfo,
        targetLineNumber: number
    ): boolean {
        return shouldPreventDropIntoContainer(this.view.state, sourceBlock, targetLineNumber, detectBlock as any);
    }
}
