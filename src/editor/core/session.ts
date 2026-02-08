import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { DROP_HIGHLIGHT_SELECTOR, DROP_INDICATOR_SELECTOR } from './selectors';

const activeDragSourceByView = new WeakMap<EditorView, BlockInfo | null>();
const knownViews = new Set<EditorView>();

export function setActiveDragSourceBlock(view: EditorView, block: BlockInfo | null): void {
    if (block) {
        activeDragSourceByView.set(view, block);
        knownViews.add(view);
        return;
    }
    activeDragSourceByView.delete(view);
    knownViews.delete(view);
}

export function getActiveDragSourceBlock(view?: EditorView): BlockInfo | null {
    if (view) {
        return activeDragSourceByView.get(view) ?? null;
    }

    for (const knownView of knownViews) {
        const block = activeDragSourceByView.get(knownView);
        if (block) return block;
    }
    return null;
}

export function clearActiveDragSourceBlock(view: EditorView): void {
    activeDragSourceByView.delete(view);
    knownViews.delete(view);
}

export function clearAllActiveDragSourceBlocks(): void {
    for (const knownView of Array.from(knownViews)) {
        activeDragSourceByView.delete(knownView);
    }
    knownViews.clear();
}

export function hideDropVisuals(scope: ParentNode = document): void {
    scope.querySelectorAll<HTMLElement>(DROP_INDICATOR_SELECTOR).forEach((el) => {
        el.style.display = 'none';
    });
    scope.querySelectorAll<HTMLElement>(DROP_HIGHLIGHT_SELECTOR).forEach((el) => {
        el.style.display = 'none';
    });
}
