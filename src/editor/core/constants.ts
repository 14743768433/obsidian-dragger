/**
 * Timing constants for semantic refresh delays based on document size
 */
export const DOC_SEMANTIC_IDLE_SMALL_MS = 500;
export const DOC_SEMANTIC_IDLE_MEDIUM_MS = 900;
export const DOC_SEMANTIC_IDLE_LARGE_MS = 1400;

/**
 * Debounce delays for embed handle scanning based on document size
 */
export const EMBED_SCAN_DEBOUNCE_SMALL_MS = 120;
export const EMBED_SCAN_DEBOUNCE_MEDIUM_MS = 300;
export const EMBED_SCAN_DEBOUNCE_LARGE_MS = 700;

/**
 * Document size thresholds (line count)
 */
export const DOC_SIZE_MEDIUM_THRESHOLD = 30_000;
export const DOC_SIZE_LARGE_THRESHOLD = 120_000;

/**
 * Interaction zone width for handle hover detection
 */
export const HANDLE_INTERACTION_ZONE_PX = 64;

/**
 * Handle visual constants
 *
 * Centralised mutable config – set once per plugin load via `applySettings()`.
 */
const handleConfig = {
    sizePx: 24,
    horizontalOffsetPx: 0,
    alignToLineNumber: true,
};

export function getHandleSizePx(): number {
    return handleConfig.sizePx;
}

export function setHandleSizePx(size: number): void {
    handleConfig.sizePx = Math.max(12, Math.min(36, size));
}

export function getHandleHorizontalOffsetPx(): number {
    return handleConfig.horizontalOffsetPx;
}

export function setHandleHorizontalOffsetPx(offsetPx: number): void {
    handleConfig.horizontalOffsetPx = Number.isFinite(offsetPx) ? offsetPx : 0;
}

export function getAlignToLineNumber(): boolean {
    return handleConfig.alignToLineNumber;
}

export function setAlignToLineNumber(align: boolean): void {
    handleConfig.alignToLineNumber = align;
}

/**
 * CSS class names
 */
export const HOVER_HIDDEN_LINE_NUMBER_CLASS = 'dnd-line-number-hover-hidden';
export const GRAB_HIDDEN_LINE_NUMBER_CLASS = 'dnd-line-number-grab-hidden';
export const BLOCK_SELECTION_ACTIVE_CLASS = 'dnd-block-selection-active';
