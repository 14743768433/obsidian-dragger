type DragHandleDomOptions = {
    onDragStart: (e: DragEvent, handle: HTMLElement) => void;
    onDragEnd?: (e: DragEvent, handle: HTMLElement) => void;
    className?: string;
};

export const DRAG_HANDLE_ICON_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="9" cy="5" r="2"/>
    <circle cx="15" cy="5" r="2"/>
    <circle cx="9" cy="12" r="2"/>
    <circle cx="15" cy="12" r="2"/>
    <circle cx="9" cy="19" r="2"/>
    <circle cx="15" cy="19" r="2"/>
  </svg>
`;

export function createDragHandleElement(options: DragHandleDomOptions): HTMLElement {
    const handle = document.createElement('div');
    handle.className = options.className ?? 'dnd-drag-handle';
    handle.setAttribute('draggable', 'true');
    handle.innerHTML = DRAG_HANDLE_ICON_SVG;
    handle.addEventListener('dragstart', (e) => options.onDragStart(e, handle));
    if (options.onDragEnd) {
        handle.addEventListener('dragend', (e) => options.onDragEnd?.(e, handle));
    }
    return handle;
}
