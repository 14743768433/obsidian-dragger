import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { EMBED_BLOCK_SELECTOR } from '../core/selectors';

type EmbedHandleEntry = {
    handle: HTMLElement;
    show: () => void;
    hide: (e: MouseEvent) => void;
};

export interface EmbedHandleManagerDeps {
    createHandleElement: (getBlockInfo: () => BlockInfo | null) => HTMLElement;
    resolveBlockInfoForEmbed: (embedEl: HTMLElement) => BlockInfo | null;
    shouldRenderEmbedHandles?: () => boolean;
}

export class EmbedHandleManager {
    private readonly embedHandles = new Map<HTMLElement, EmbedHandleEntry>();
    private observer: MutationObserver | null = null;
    private pendingScan = false;
    private readonly onScrollOrResize = () => this.updateHandlePositions();
    private readonly onDeactivate = () => this.hideAllHandles();

    constructor(
        private readonly view: EditorView,
        private readonly deps: EmbedHandleManagerDeps
    ) { }

    private shouldRenderEmbedHandles(): boolean {
        if (!this.deps.shouldRenderEmbedHandles) return true;
        return this.deps.shouldRenderEmbedHandles();
    }

    start(): void {
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
        this.view.dom.addEventListener('mouseleave', this.onDeactivate);
        window.addEventListener('blur', this.onDeactivate);

        this.rescan();
    }

    scheduleScan(): void {
        if (this.pendingScan) return;
        this.pendingScan = true;
        requestAnimationFrame(() => {
            this.pendingScan = false;
            this.rescan();
        });
    }

    rescan(): void {
        if (!this.shouldRenderEmbedHandles()) {
            for (const [embedEl, entry] of this.embedHandles.entries()) {
                this.cleanupHandle(embedEl, entry);
            }
            this.embedHandles.clear();
            return;
        }

        const embeds = this.view.dom.querySelectorAll(EMBED_BLOCK_SELECTOR);
        const handled = new Set<HTMLElement>();

        embeds.forEach((embed) => {
            const rawEl = embed as HTMLElement;
            const embedEl = (rawEl.closest('.cm-embed-block') as HTMLElement | null) ?? rawEl;
            if (handled.has(embedEl)) return;
            handled.add(embedEl);

            const getBlockInfo = () => this.deps.resolveBlockInfoForEmbed(embedEl);
            const block = getBlockInfo();
            if (!block) return;

            let entry = this.embedHandles.get(embedEl);
            if (!entry) {
                const handle = this.deps.createHandleElement(getBlockInfo);
                handle.classList.add('dnd-embed-handle');
                handle.style.position = 'fixed';
                document.body.appendChild(handle);

                const show = () => {
                    if (!this.isEmbedVisible(embedEl)) return;
                    handle.style.display = '';
                    handle.classList.add('is-visible');
                };
                const hide = (e: MouseEvent) => {
                    const related = e.relatedTarget as Node | null;
                    if (related && (related === handle || handle.contains(related))) return;
                    handle.classList.remove('is-visible');
                };

                embedEl.addEventListener('mouseenter', show);
                embedEl.addEventListener('mouseleave', hide);
                handle.addEventListener('mouseenter', show);
                handle.addEventListener('mouseleave', hide);

                entry = { handle, show, hide };
                this.embedHandles.set(embedEl, entry);
            }

            entry.handle.setAttribute('data-block-start', String(block.startLine));
            entry.handle.setAttribute('data-block-end', String(block.endLine));
            this.positionHandle(embedEl, entry.handle);
        });

        for (const [embedEl, entry] of this.embedHandles.entries()) {
            if (!handled.has(embedEl) || !document.body.contains(embedEl)) {
                this.cleanupHandle(embedEl, entry);
                this.embedHandles.delete(embedEl);
            }
        }
    }

    updateHandlePositions(): void {
        if (!this.shouldRenderEmbedHandles()) return;
        for (const [embedEl, entry] of this.embedHandles.entries()) {
            if (!document.body.contains(embedEl)) continue;
            this.positionHandle(embedEl, entry.handle);
        }
    }

    hideAllHandles(): void {
        if (!this.shouldRenderEmbedHandles()) return;
        for (const entry of this.embedHandles.values()) {
            entry.handle.classList.remove('is-visible');
            entry.handle.style.display = 'none';
        }
    }

    destroy(): void {
        this.pendingScan = false;
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.view.scrollDOM.removeEventListener('scroll', this.onScrollOrResize);
        window.removeEventListener('resize', this.onScrollOrResize);
        this.view.dom.removeEventListener('mouseleave', this.onDeactivate);
        window.removeEventListener('blur', this.onDeactivate);

        for (const [embedEl, entry] of this.embedHandles.entries()) {
            this.cleanupHandle(embedEl, entry);
        }
        this.embedHandles.clear();
    }

    private cleanupHandle(embedEl: HTMLElement, entry: EmbedHandleEntry): void {
        embedEl.removeEventListener('mouseenter', entry.show);
        embedEl.removeEventListener('mouseleave', entry.hide);
        entry.handle.removeEventListener('mouseenter', entry.show);
        entry.handle.removeEventListener('mouseleave', entry.hide);
        entry.handle.remove();
    }

    private positionHandle(embedEl: HTMLElement, handle: HTMLElement): void {
        if (!this.isEmbedVisible(embedEl)) {
            handle.classList.remove('is-visible');
            handle.style.display = 'none';
            return;
        }

        handle.style.display = '';
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const embedRect = embedEl.getBoundingClientRect();
        const contentPaddingLeft = parseFloat(getComputedStyle(this.view.contentDOM).paddingLeft) || 0;
        const left = Math.round(contentRect.left + contentPaddingLeft - 42);
        const top = Math.round(embedRect.top + 8);
        handle.style.left = `${left}px`;
        handle.style.top = `${top}px`;
    }

    private isEmbedVisible(embedEl: HTMLElement): boolean {
        if (!embedEl.isConnected) return false;
        const style = getComputedStyle(embedEl);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }
        const rect = embedEl.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
        if (rect.right < 0 || rect.left > window.innerWidth) return false;
        return true;
    }
}
