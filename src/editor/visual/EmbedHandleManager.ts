import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { EMBED_BLOCK_SELECTOR, EMBED_HANDLE_CLASS } from '../core/selectors';
import {
    getHandleColumnLeftPx,
    getHandleLeftPxForLine,
    getHandleTopPxForLine,
    viewportXToEditorLocalX,
    viewportYToEditorLocalY,
} from '../core/handle-position';
import {
    getHandleSizePx,
    EMBED_SCAN_DEBOUNCE_SMALL_MS,
    EMBED_SCAN_DEBOUNCE_MEDIUM_MS,
    EMBED_SCAN_DEBOUNCE_LARGE_MS,
} from '../core/constants';

type EmbedHandleEntry = {
    handle: HTMLElement;
};



export interface EmbedHandleManagerDeps {
    createHandleElement: (getBlockInfo: () => BlockInfo | null) => HTMLElement;
    resolveBlockInfoForEmbed: (embedEl: HTMLElement) => BlockInfo | null;
    shouldRenderEmbedHandles?: () => boolean;
}

export class EmbedHandleManager {
    private readonly embedHandles = new Map<HTMLElement, EmbedHandleEntry>();
    private readonly handleSet = new Set<HTMLElement>();
    private observer: MutationObserver | null = null;
    private pendingScan = false;
    private rafId: number | null = null;
    private debounceTimerId: number | null = null;
    private destroyed = false;
    private readonly onScrollOrResize = () => this.updateHandlePositions();

    constructor(
        private readonly view: EditorView,
        private readonly deps: EmbedHandleManagerDeps
    ) { }

    private shouldRenderEmbedHandles(): boolean {
        if (!this.deps.shouldRenderEmbedHandles) return true;
        return this.deps.shouldRenderEmbedHandles();
    }

    start(): void {
        this.destroyed = false;
        if (!this.observer) {
            this.observer = new MutationObserver(() => this.scheduleScan());
            this.observer.observe(this.view.dom, {
                childList: true,
                subtree: true,
                attributes: false,
            });
        }

        this.view.scrollDOM.addEventListener('scroll', this.onScrollOrResize, { passive: true });
        window.addEventListener('resize', this.onScrollOrResize);

        this.rescan();
    }

    scheduleScan(options?: { urgent?: boolean }): void {
        if (this.destroyed) return;
        if (options?.urgent !== true) {
            this.scheduleDebouncedScan();
            return;
        }
        if (this.debounceTimerId !== null) {
            window.clearTimeout(this.debounceTimerId);
            this.debounceTimerId = null;
        }
        if (this.pendingScan) return;
        this.pendingScan = true;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            if (this.destroyed) return;
            this.pendingScan = false;
            this.rescan();
        });
    }

    rescan(): void {
        if (this.destroyed) return;
        if (!this.shouldRenderEmbedHandles()) {
            for (const [embedEl, entry] of this.embedHandles.entries()) {
                this.cleanupHandle(embedEl, entry);
            }
            this.embedHandles.clear();
            return;
        }

        const embeds = this.view.dom.querySelectorAll<HTMLElement>(EMBED_BLOCK_SELECTOR);
        const handled = new Set<HTMLElement>();

        embeds.forEach((embed) => {
            const embedEl = embed.closest<HTMLElement>('.cm-embed-block') ?? embed;
            if (handled.has(embedEl)) return;
            handled.add(embedEl);

            const getBlockInfo = () => this.deps.resolveBlockInfoForEmbed(embedEl);
            const block = getBlockInfo();
            if (!block) return;

            // Avoid duplicated handles when a line-level handle already represents this block.
            if (this.hasInlineHandleForBlockStart(block.startLine)) {
                const duplicated = this.embedHandles.get(embedEl);
                if (duplicated) {
                    this.cleanupHandle(embedEl, duplicated);
                    this.embedHandles.delete(embedEl);
                }
                return;
            }

            let entry = this.embedHandles.get(embedEl);
            if (!entry) {
                const handle = this.deps.createHandleElement(getBlockInfo);
                handle.classList.add(EMBED_HANDLE_CLASS);
                this.view.dom.appendChild(handle);

                entry = { handle };
                this.embedHandles.set(embedEl, entry);
                this.handleSet.add(handle);
            }

            entry.handle.setAttribute('data-block-start', String(block.startLine));
            entry.handle.setAttribute('data-block-end', String(block.endLine));
            this.positionHandle(embedEl, entry.handle);
        });

        for (const [embedEl, entry] of this.embedHandles.entries()) {
            if (!handled.has(embedEl) || !this.view.dom.contains(embedEl)) {
                this.cleanupHandle(embedEl, entry);
                this.embedHandles.delete(embedEl);
            }
        }
    }

    updateHandlePositions(): void {
        if (!this.shouldRenderEmbedHandles()) return;
        for (const [embedEl, entry] of this.embedHandles.entries()) {
            if (!this.view.dom.contains(embedEl)) continue;
            this.positionHandle(embedEl, entry.handle);
        }
    }

    destroy(): void {
        this.destroyed = true;
        this.pendingScan = false;
        if (this.debounceTimerId !== null) {
            window.clearTimeout(this.debounceTimerId);
            this.debounceTimerId = null;
        }
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.view.scrollDOM.removeEventListener('scroll', this.onScrollOrResize);
        window.removeEventListener('resize', this.onScrollOrResize);

        for (const [embedEl, entry] of this.embedHandles.entries()) {
            this.cleanupHandle(embedEl, entry);
        }
        this.embedHandles.clear();
    }

    private scheduleDebouncedScan(): void {
        if (this.debounceTimerId !== null) {
            window.clearTimeout(this.debounceTimerId);
            this.debounceTimerId = null;
        }
        const delayMs = this.getDebounceDelayMs();
        this.debounceTimerId = window.setTimeout(() => {
            this.debounceTimerId = null;
            this.scheduleScan({ urgent: true });
        }, delayMs);
    }

    private getDebounceDelayMs(): number {
        const docLines = this.view.state.doc.lines;
        if (docLines > 120_000) return EMBED_SCAN_DEBOUNCE_LARGE_MS;
        if (docLines > 30_000) return EMBED_SCAN_DEBOUNCE_MEDIUM_MS;
        return EMBED_SCAN_DEBOUNCE_SMALL_MS;
    }

    private cleanupHandle(_embedEl: HTMLElement, entry: EmbedHandleEntry): void {
        this.handleSet.delete(entry.handle);
        entry.handle.remove();
    }

    isManagedHandle(handle: HTMLElement): boolean {
        return this.handleSet.has(handle);
    }

    private hasInlineHandleForBlockStart(blockStartLine: number): boolean {
        const selector = `.dnd-drag-handle.dnd-line-handle[data-block-start="${blockStartLine}"]`;
        return !!this.view.dom.querySelector(selector);
    }

    private positionHandle(embedEl: HTMLElement, handle: HTMLElement): void {
        if (!this.isEmbedVisible(embedEl)) {
            handle.classList.remove('is-visible');
            handle.classList.add('dnd-hidden');
            return;
        }

        handle.classList.remove('dnd-hidden');
        const lineNumber = this.resolveHandleLineNumber(handle);
        const left = lineNumber
            ? getHandleLeftPxForLine(this.view, lineNumber)
            : getHandleColumnLeftPx(this.view);
        const top = lineNumber
            ? (getHandleTopPxForLine(this.view, lineNumber) ?? this.getEmbedFallbackTop(embedEl))
            : this.getEmbedFallbackTop(embedEl);
        if (left === null) {
            handle.classList.add('dnd-hidden');
            return;
        }
        const localLeft = viewportXToEditorLocalX(this.view, left);
        const localTop = viewportYToEditorLocalY(this.view, top);
        handle.setCssStyles({
            left: `${Math.round(localLeft)}px`,
            top: `${Math.round(localTop)}px`,
        });
    }

    private resolveHandleLineNumber(handle: HTMLElement): number | null {
        const startAttr = handle.getAttribute('data-block-start');
        if (startAttr === null) return null;
        const lineNumber = Number(startAttr) + 1;
        if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > this.view.state.doc.lines) {
            return null;
        }
        return lineNumber;
    }

    private getEmbedFallbackTop(embedEl: HTMLElement): number {
        const embedRect = embedEl.getBoundingClientRect();
        const lineCenterOffset = Math.max(0, (this.view.defaultLineHeight || 20) / 2 - getHandleSizePx() / 2);
        return Math.round(embedRect.top + lineCenterOffset);
    }

    private isEmbedVisible(embedEl: HTMLElement): boolean {
        if (!embedEl.isConnected) return false;
        const style = getComputedStyle(embedEl);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }
        const rect = embedEl.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
        if (rect.bottom <= scrollerRect.top || rect.top >= scrollerRect.bottom) return false;
        if (rect.right <= scrollerRect.left || rect.left >= scrollerRect.right) return false;
        return true;
    }
}
