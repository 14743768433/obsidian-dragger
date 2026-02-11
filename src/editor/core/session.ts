import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { DROP_HIGHLIGHT_SELECTOR, DROP_INDICATOR_SELECTOR } from './selectors';

const activeDragSourceByView = new WeakMap<EditorView, BlockInfo | null>();
const knownViewRefs = new Set<WeakRef<EditorView>>();

export function setActiveDragSourceBlock(view: EditorView, block: BlockInfo | null): void {
    if (block) {
        activeDragSourceByView.set(view, block);
        knownViewRefs.add(new WeakRef(view));
        return;
    }
    activeDragSourceByView.delete(view);
    removeWeakRef(knownViewRefs, view);
}

export function getActiveDragSourceBlock(view?: EditorView): BlockInfo | null {
    if (view) {
        return activeDragSourceByView.get(view) ?? null;
    }

    for (const ref of knownViewRefs) {
        const v = ref.deref();
        if (!v) {
            knownViewRefs.delete(ref);
            continue;
        }
        const block = activeDragSourceByView.get(v);
        if (block) return block;
    }
    return null;
}

export function clearActiveDragSourceBlock(view: EditorView): void {
    activeDragSourceByView.delete(view);
    removeWeakRef(knownViewRefs, view);
}

export function clearAllActiveDragSourceBlocks(): void {
    for (const ref of knownViewRefs) {
        const v = ref.deref();
        if (v) activeDragSourceByView.delete(v);
    }
    knownViewRefs.clear();
}

function removeWeakRef(set: Set<WeakRef<EditorView>>, target: EditorView): void {
    for (const ref of set) {
        const v = ref.deref();
        if (!v || v === target) {
            set.delete(ref);
        }
    }
}

export function hideDropVisuals(scope: ParentNode = document): void {
    scope.querySelectorAll<HTMLElement>(DROP_INDICATOR_SELECTOR).forEach((el) => {
        el.classList.add('dnd-hidden');
    });
    scope.querySelectorAll<HTMLElement>(DROP_HIGHLIGHT_SELECTOR).forEach((el) => {
        el.classList.add('dnd-hidden');
    });
}
