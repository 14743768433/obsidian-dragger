import { EditorView } from '@codemirror/view';
import { detectBlock } from '../block-detector';
import { BlockInfo } from '../../types';
import { shouldPreventDropIntoDifferentContainer as shouldPreventDropIntoContainer } from '../core/container-policies';

export class ContainerPolicyService {
    constructor(private readonly view: EditorView) { }

    shouldPreventDropIntoDifferentContainer(
        sourceBlock: BlockInfo,
        targetLineNumber: number
    ): boolean {
        return shouldPreventDropIntoContainer(this.view.state, sourceBlock, targetLineNumber, detectBlock as any);
    }
}
