import { Extension } from '@codemirror/state';
import {
    EditorView,
    ViewPlugin,
    ViewUpdate,
    Decoration,
    DecorationSet,
    WidgetType,
} from '@codemirror/view';
import { detectBlock, detectBlockType } from './block-detector';
import { BlockType, BlockInfo, DragState } from '../types';
import DragNDropPlugin from '../main';

type EmbedHandleEntry = {
    handle: HTMLElement;
    show: () => void;
    hide: (e: MouseEvent) => void;
};

/**
 * 拖拽手柄 Widget
 */
class DragHandleWidget extends WidgetType {
    private blockInfo: BlockInfo;
    private view: EditorView;
    private plugin: DragNDropPlugin;

    constructor(blockInfo: BlockInfo, view: EditorView, plugin: DragNDropPlugin) {
        super();
        this.blockInfo = blockInfo;
        this.view = view;
        this.plugin = plugin;
    }

    toDOM(): HTMLElement {
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        handle.setAttribute('data-block-start', String(this.blockInfo.startLine));
        handle.setAttribute('data-block-end', String(this.blockInfo.endLine));

        // 拖拽图标（六个点）
        handle.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="9" cy="5" r="2"/>
        <circle cx="15" cy="5" r="2"/>
        <circle cx="9" cy="12" r="2"/>
        <circle cx="15" cy="12" r="2"/>
        <circle cx="9" cy="19" r="2"/>
        <circle cx="15" cy="19" r="2"/>
      </svg>
    `;

        // 拖拽事件
        handle.addEventListener('dragstart', (e) => this.onDragStart(e));
        handle.addEventListener('dragend', (e) => this.onDragEnd(e));

        return handle;
    }

    private onDragStart(e: DragEvent): void {
        if (!e.dataTransfer) return;

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.blockInfo.content);
        e.dataTransfer.setData('application/dnd-block', JSON.stringify(this.blockInfo));

        // 添加拖拽中的类
        document.body.classList.add('dnd-dragging');

        // 创建拖拽时的ghost image
        const ghost = document.createElement('div');
        ghost.className = 'dnd-drag-ghost';
        ghost.textContent = this.blockInfo.content.slice(0, 50) + (this.blockInfo.content.length > 50 ? '...' : '');
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);

        // 延迟移除ghost元素
        setTimeout(() => ghost.remove(), 0);

        console.log('Drag start:', this.blockInfo);
    }

    private onDragEnd(e: DragEvent): void {
        document.body.classList.remove('dnd-dragging');
        // 清理放置指示器
        document.querySelectorAll('.dnd-drop-indicator').forEach(el => el.remove());
        console.log('Drag end');
    }

    eq(other: DragHandleWidget): boolean {
        return this.blockInfo.from === other.blockInfo.from
            && this.blockInfo.to === other.blockInfo.to;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * 创建拖拽手柄ViewPlugin
 */
function createDragHandleViewPlugin(plugin: DragNDropPlugin) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            observer: MutationObserver;
            plugin: DragNDropPlugin;
            view: EditorView;
            embedHandles: Map<HTMLElement, EmbedHandleEntry>;
            onScrollOrResize: () => void;
            onDeactivate: () => void;
            lastDropTargetLineNumber: number | null;

            constructor(view: EditorView) {
                this.view = view;
                this.plugin = plugin;
                this.embedHandles = new Map();
                this.lastDropTargetLineNumber = null;
                this.decorations = this.buildDecorations(view);
                this.setupDropListeners(view);
                this.setupEmbedBlockObserver(view);
                this.onScrollOrResize = () => this.updateEmbedHandlePositions();
                view.scrollDOM.addEventListener('scroll', this.onScrollOrResize, { passive: true });
                window.addEventListener('resize', this.onScrollOrResize);
                this.onDeactivate = () => this.hideAllEmbedHandles();
                view.dom.addEventListener('mouseleave', this.onDeactivate);
                window.addEventListener('blur', this.onDeactivate);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = this.buildDecorations(update.view);
                    // 文档变化后重新扫描渲染块
                    this.addHandlesToEmbedBlocks(update.view);
                    this.updateEmbedHandlePositions();
                }
            }

            buildDecorations(view: EditorView): DecorationSet {
                const decorations: any[] = [];
                const doc = view.state.doc;
                const processedLines = new Set<number>();

                // 遍历可见范围内的行
                for (const { from, to } of view.visibleRanges) {
                    let pos = from;
                    while (pos <= to) {
                        const line = doc.lineAt(pos);
                        const lineNumber = line.number;

                        // 跳过已处理的行
                        if (processedLines.has(lineNumber)) {
                            pos = line.to + 1;
                            continue;
                        }

                        const block = detectBlock(view.state, lineNumber);
                        if (block) {
                            // 在块的起始行添加拖拽手柄
                            const widget = new DragHandleWidget(block, view, plugin);
                            decorations.push(
                                Decoration.widget({
                                    widget,
                                    side: -1, // 在行内容之前
                                }).range(line.from)
                            );

                            // 标记所有属于这个块的行为已处理
                            for (let i = block.startLine; i <= block.endLine; i++) {
                                processedLines.add(i + 1);
                            }
                        }

                        pos = line.to + 1;
                    }
                }

                return Decoration.set(decorations, true);
            }

            setupEmbedBlockObserver(view: EditorView) {
                this.observer = new MutationObserver((mutations) => {
                    this.addHandlesToEmbedBlocks(view);
                });

                this.observer.observe(view.dom, {
                    childList: true,
                    subtree: true,
                    attributes: false
                });

                // 初始扫描
                this.addHandlesToEmbedBlocks(view);
            }

            addHandlesToEmbedBlocks(view: EditorView) {
                // 扩展选择器以支持更多类型
                const embeds = view.dom.querySelectorAll('.cm-embed-block, .cm-callout, .cm-preview-code-block, .cm-math, .MathJax_Display');

                const handled = new Set<HTMLElement>();

                embeds.forEach(embed => {
                    const rawEl = embed as HTMLElement;
                    const embedEl = (rawEl.closest('.cm-embed-block') as HTMLElement | null) ?? rawEl;

                    if (handled.has(embedEl)) return;
                    handled.add(embedEl);

                    // 清理旧的内嵌手柄（避免残留）
                    embedEl.querySelectorAll(':scope > .dnd-embed-handle').forEach(el => el.remove());

                    const getBlockInfo = () => this.getBlockInfoForEmbed(view, embedEl);
                    const block = getBlockInfo();

                    if (block) {
                        let entry = this.embedHandles.get(embedEl);
                        if (!entry) {
                            const handle = this.createHandleElement(view, getBlockInfo);
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

                        this.positionEmbedHandle(embedEl, entry.handle);
                    }
                });

                for (const [embedEl, entry] of this.embedHandles.entries()) {
                    if (!handled.has(embedEl) || !document.body.contains(embedEl)) {
                        embedEl.removeEventListener('mouseenter', entry.show);
                        embedEl.removeEventListener('mouseleave', entry.hide);
                        entry.handle.removeEventListener('mouseenter', entry.show);
                        entry.handle.removeEventListener('mouseleave', entry.hide);
                        entry.handle.remove();
                        this.embedHandles.delete(embedEl);
                    }
                }
            }

            positionEmbedHandle(embedEl: HTMLElement, handle: HTMLElement) {
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

            isEmbedVisible(embedEl: HTMLElement): boolean {
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

            getBlockInfoForEmbed(view: EditorView, embedEl: HTMLElement): BlockInfo | null {
                // 获取对应的文档位置
                let pos: number | null = null;
                try {
                    pos = view.posAtDOM(embedEl);
                } catch {
                    pos = null;
                }

                // 如果直接获取失败，尝试获取父元素位置
                if (pos === null && embedEl.parentElement) {
                    try {
                        pos = view.posAtDOM(embedEl.parentElement);
                    } catch {
                        pos = null;
                    }
                }

                // 如果仍然失败，尝试使用坐标定位
                if (pos === null) {
                    const rect = embedEl.getBoundingClientRect();
                    const coordsPos = view.posAtCoords({ x: rect.left + 4, y: rect.top + 4 });
                    if (coordsPos !== null) {
                        pos = coordsPos;
                    }
                }

                if (pos === null) return null;

                const line = view.state.doc.lineAt(pos);
                return detectBlock(view.state, line.number);
            }

            updateEmbedHandlePositions() {
                for (const [embedEl, entry] of this.embedHandles.entries()) {
                    if (!document.body.contains(embedEl)) continue;
                    this.positionEmbedHandle(embedEl, entry.handle);
                }
            }

            hideAllEmbedHandles() {
                for (const entry of this.embedHandles.values()) {
                    entry.handle.classList.remove('is-visible');
                    entry.handle.style.display = 'none';
                }
            }

            createHandleElement(view: EditorView, getBlockInfo: () => BlockInfo | null): HTMLElement {
                const handle = document.createElement('div');
                handle.className = 'dnd-drag-handle';
                handle.setAttribute('draggable', 'true');

                handle.innerHTML = `
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="5" r="2"/>
                    <circle cx="15" cy="5" r="2"/>
                    <circle cx="9" cy="12" r="2"/>
                    <circle cx="15" cy="12" r="2"/>
                    <circle cx="9" cy="19" r="2"/>
                    <circle cx="15" cy="19" r="2"/>
                  </svg>
                `;

                // 复用 DragHandleWidget 的事件处理逻辑
                // 但由于 DragHandleWidget 是 WidgetType，上面的 onDragStart 是 private
                // 我们需要重新绑定或者将逻辑提取出来。
                // 为了简单起见，这里重新实现简单的绑定，调用 widget 的方法（如果如果是 public）
                // 或者直接在这里实现

                handle.addEventListener('dragstart', (e) => {
                    // 复制 widget.onDragStart 的逻辑
                    if (!e.dataTransfer) return;
                    const blockInfo = getBlockInfo();
                    if (!blockInfo) {
                        e.preventDefault();
                        return;
                    }

                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', blockInfo.content);
                    e.dataTransfer.setData('application/dnd-block', JSON.stringify(blockInfo));
                    handle.setAttribute('data-block-start', String(blockInfo.startLine));
                    handle.setAttribute('data-block-end', String(blockInfo.endLine));

                    document.body.classList.add('dnd-dragging');

                    const ghost = document.createElement('div');
                    ghost.className = 'dnd-drag-ghost';
                    ghost.textContent = blockInfo.content.slice(0, 50) + (blockInfo.content.length > 50 ? '...' : '');
                    document.body.appendChild(ghost);
                    e.dataTransfer.setDragImage(ghost, 0, 0);

                    setTimeout(() => ghost.remove(), 0);

                    console.log('Embed Drag start:', blockInfo);
                });

                handle.addEventListener('dragend', (e) => {
                    document.body.classList.remove('dnd-dragging');
                    document.querySelectorAll('.dnd-drop-indicator').forEach(el => el.remove());
                    console.log('Embed Drag end');
                });

                return handle;
            }

            setupDropListeners(view: EditorView): void {
                const editorDom = view.dom;
                const shouldHandleDrag = (e: DragEvent) => {
                    if (!e.dataTransfer) return false;
                    return Array.from(e.dataTransfer.types).includes('application/dnd-block');
                };

                // 必须在dragenter时也设置dropEffect来防止光标闪烁
                editorDom.addEventListener('dragenter', (e: DragEvent) => {
                    if (!shouldHandleDrag(e)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) {
                        e.dataTransfer.dropEffect = 'move';
                    }
                }, true);

                editorDom.addEventListener('dragover', (e: DragEvent) => {
                    if (!shouldHandleDrag(e)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (!e.dataTransfer) return;

                    e.dataTransfer.dropEffect = 'move';

                    // 显示放置指示器
                    this.showDropIndicator(view, e);
                }, true);

                editorDom.addEventListener('dragleave', (e: DragEvent) => {
                    if (!shouldHandleDrag(e)) return;
                    // 只有当离开编辑器区域时才隐藏指示器
                    const rect = editorDom.getBoundingClientRect();
                    if (e.clientX < rect.left || e.clientX > rect.right ||
                        e.clientY < rect.top || e.clientY > rect.bottom) {
                        this.hideDropIndicator();
                    }
                }, true);

                editorDom.addEventListener('drop', (e: DragEvent) => {
                    if (!shouldHandleDrag(e)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (!e.dataTransfer) return;

                    const blockDataStr = e.dataTransfer.getData('application/dnd-block');
                    if (!blockDataStr) return;

                    const sourceBlock: BlockInfo = JSON.parse(blockDataStr);
                    const targetInfo = this.getDropTargetInfo(view, e);
                    const targetLineNumber = targetInfo?.lineNumber ?? null;
                    const targetPos = targetLineNumber
                        ? (targetLineNumber > view.state.doc.lines
                            ? view.state.doc.length
                            : view.state.doc.line(targetLineNumber).from)
                        : view.posAtCoords({ x: e.clientX, y: e.clientY });

                    if (targetPos === null) return;

                    this.moveBlock(view, sourceBlock, targetPos, targetLineNumber ?? undefined);
                    this.hideDropIndicator();
                }, true);
            }

            showDropIndicator(view: EditorView, e: DragEvent): void {
                this.hideDropIndicator();

                const targetInfo = this.getDropTargetInfo(view, e);
                if (!targetInfo) return;

                this.lastDropTargetLineNumber = targetInfo.lineNumber;

                const editorRect = view.dom.getBoundingClientRect();
                const indicatorY = targetInfo.indicatorY;

                const indicator = document.createElement('div');
                indicator.className = 'dnd-drop-indicator';
                // 使用fixed定位，基于视口坐标
                indicator.style.position = 'fixed';
                indicator.style.top = `${indicatorY}px`;
                indicator.style.left = `${editorRect.left + 35}px`;
                indicator.style.width = `${editorRect.width - 50}px`;

                document.body.appendChild(indicator);
            }

            hideDropIndicator(): void {
                document.querySelectorAll('.dnd-drop-indicator').forEach(el => el.remove());
                this.lastDropTargetLineNumber = null;
            }

            moveBlock(view: EditorView, sourceBlock: BlockInfo, targetPos: number, targetLineNumberOverride?: number): void {
                const doc = view.state.doc;
                const targetLine = doc.lineAt(targetPos);

                // 检测目标位置是否在多行块内部，如果是则调整到块边界
                const targetBlock = detectBlock(view.state, targetLine.number);
                let targetLineNumber = targetLineNumberOverride ?? targetLine.number;

                if (targetLineNumberOverride === undefined && targetBlock && (targetBlock.type === BlockType.CodeBlock ||
                    targetBlock.type === BlockType.Blockquote ||
                    targetBlock.type === BlockType.Table ||
                    targetBlock.type === BlockType.MathBlock)) {
                    // 使用块的边界
                    if (targetLine.number - 1 <= (targetBlock.startLine + targetBlock.endLine) / 2) {
                        targetLineNumber = targetBlock.startLine + 1;
                    } else {
                        targetLineNumber = targetBlock.endLine + 2; // 插入到块后面
                    }
                }

                targetLineNumber = this.clampTargetLineNumber(doc.lines, targetLineNumber);

                // 转换为0-indexed
                const targetLineIdx = targetLineNumber - 1;

                // 不能移动到自己的位置
                if (targetLineIdx >= sourceBlock.startLine && targetLineIdx <= sourceBlock.endLine + 1) {
                    return;
                }

                // 获取源块的文档位置
                const sourceStartLine = doc.line(sourceBlock.startLine + 1);
                const sourceEndLine = doc.line(sourceBlock.endLine + 1);
                const sourceFrom = sourceStartLine.from;
                const sourceTo = sourceEndLine.to;
                const sourceContent = doc.sliceString(sourceFrom, sourceTo);
                const insertText = this.buildInsertText(doc, sourceBlock, targetLineNumber, sourceContent);

                // CodeMirror 的 changes 数组位置都是基于原始文档的，不需要手动计算偏移
                // 但必须按照从后到前的顺序排列 changes（位置大的在前）
                if (targetLineIdx < sourceBlock.startLine) {
                    // 向上移动
                    const insertPos = targetLineNumber > doc.lines
                        ? doc.length
                        : doc.line(targetLineNumber).from;

                    // 删除源块（包括换行符）
                    const deleteFrom = sourceFrom;
                    const deleteTo = Math.min(sourceTo + 1, doc.length);

                    view.dispatch({
                        changes: [
                            // 必须按位置从大到小排序
                            { from: deleteFrom, to: deleteTo },  // 删除原位置
                            { from: insertPos, to: insertPos, insert: insertText },  // 插入到目标位置
                        ].sort((a, b) => b.from - a.from),
                        scrollIntoView: false,
                    });
                } else {
                    // 向下移动
                    const insertPos = targetLineNumber > doc.lines
                        ? doc.length
                        : doc.line(targetLineNumber).from;

                    // 删除源块（包括换行符）
                    const deleteFrom = sourceFrom;
                    const deleteTo = Math.min(sourceTo + 1, doc.length);

                    view.dispatch({
                        changes: [
                            // 必须按位置从大到小排序
                            { from: insertPos, to: insertPos, insert: insertText },  // 插入到目标位置
                            { from: deleteFrom, to: deleteTo },  // 删除原位置
                        ].sort((a, b) => b.from - a.from),
                        scrollIntoView: false,
                    });
                }

                console.log('Block moved');
            }

            buildInsertText(doc: { line: (n: number) => { text: string }; lines: number }, sourceBlock: BlockInfo, targetLineNumber: number, sourceContent: string): string {
                const prevLineNumber = Math.min(Math.max(1, targetLineNumber - 1), doc.lines);
                const prevText = targetLineNumber > 1 ? doc.line(prevLineNumber).text : null;
                const nextText = targetLineNumber <= doc.lines ? doc.line(targetLineNumber).text : null;
                const needsLeadingBlank = this.shouldSeparateBlock(sourceBlock.type, prevText);
                const needsTrailingBlank = this.shouldSeparateBlock(sourceBlock.type, nextText);

                let text = sourceContent;
                if (needsLeadingBlank) text = '\n' + text;
                const trailingNewlines = 1 + (needsTrailingBlank ? 1 : 0);
                text += '\n'.repeat(trailingNewlines);
                return text;
            }

            clampTargetLineNumber(totalLines: number, lineNumber: number): number {
                if (lineNumber < 1) return 1;
                if (lineNumber > totalLines + 1) return totalLines + 1;
                return lineNumber;
            }

            shouldSeparateBlock(type: BlockType, adjacentLineText: string | null): boolean {
                if (!adjacentLineText) return false;
                if (adjacentLineText.trim().length === 0) return false;

                const trimmed = adjacentLineText.trimStart();
                if (type === BlockType.Blockquote) {
                    return trimmed.startsWith('>');
                }
                if (type === BlockType.Table) {
                    return trimmed.startsWith('|');
                }

                return false;
            }

            getDropTargetInfo(view: EditorView, e: DragEvent): { lineNumber: number; indicatorY: number } | null {
                const embedEl = this.getEmbedElementAtPoint(view, e);
                if (embedEl) {
                    const block = this.getBlockInfoForEmbed(view, embedEl);
                    if (block) {
                        const rect = embedEl.getBoundingClientRect();
                        const showAtBottom = e.clientY > rect.top + rect.height / 2;
                        const lineNumber = this.clampTargetLineNumber(view.state.doc.lines, showAtBottom ? block.endLine + 2 : block.startLine + 1);
                        const indicatorY = showAtBottom ? rect.bottom : rect.top;
                        return { lineNumber, indicatorY };
                    }
                }

                const contentRect = view.contentDOM.getBoundingClientRect();
                const x = this.clampNumber(e.clientX, contentRect.left + 2, contentRect.right - 2);
                const pos = view.posAtCoords({ x, y: e.clientY });
                if (pos === null) return null;

                let line = view.state.doc.lineAt(pos);
                let showAtBottom = false;
                let forcedLineNumber: number | null = null;

                // 检测当前行是否在代码块或引用块内部
                const blockAtPos = detectBlock(view.state, line.number);

                // 如果在多行块（代码块、引用块、表格）内部，将指示器移到块边界
                if (blockAtPos && (blockAtPos.type === BlockType.CodeBlock ||
                    blockAtPos.type === BlockType.Blockquote ||
                    blockAtPos.type === BlockType.Table ||
                    blockAtPos.type === BlockType.MathBlock)) {

                    // 判断鼠标位置更接近块的上边界还是下边界
                    const blockStartLine = view.state.doc.line(blockAtPos.startLine + 1);
                    const blockEndLine = view.state.doc.line(blockAtPos.endLine + 1);

                    const startCoords = view.coordsAtPos(blockStartLine.from);
                    const endCoords = view.coordsAtPos(blockEndLine.to);

                    if (startCoords && endCoords) {
                        const mouseY = e.clientY;
                        const midPoint = (startCoords.top + endCoords.bottom) / 2;

                        // 根据鼠标位置选择在块的上方或下方显示指示器
                        if (mouseY < midPoint) {
                            line = blockStartLine;
                            showAtBottom = false;
                            forcedLineNumber = blockAtPos.startLine + 1;
                        } else {
                            line = blockEndLine;
                            showAtBottom = true;
                            forcedLineNumber = blockAtPos.endLine + 2;
                        }
                    }
                }

                const coords = showAtBottom
                    ? view.coordsAtPos(line.to)
                    : view.coordsAtPos(line.from);
                if (!coords) return null;

                const indicatorY = showAtBottom ? coords.bottom : coords.top;
                const lineNumber = forcedLineNumber ?? (showAtBottom ? line.number + 1 : line.number);
                return { lineNumber: this.clampTargetLineNumber(view.state.doc.lines, lineNumber), indicatorY };
            }

            getEmbedElementAtPoint(view: EditorView, e: DragEvent): HTMLElement | null {
                const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
                if (el) {
                    const direct = el.closest('.cm-embed-block, .cm-callout, .cm-preview-code-block, .cm-math, .MathJax_Display') as HTMLElement | null;
                    if (direct) {
                        return (direct.closest('.cm-embed-block') as HTMLElement | null) ?? direct;
                    }
                }

                const editorRect = view.dom.getBoundingClientRect();
                if (e.clientY < editorRect.top || e.clientY > editorRect.bottom) return null;
                if (e.clientX < editorRect.left || e.clientX > editorRect.right) return null;

                const embeds = Array.from(
                    view.dom.querySelectorAll('.cm-embed-block, .cm-callout, .cm-preview-code-block, .cm-math, .MathJax_Display')
                ) as HTMLElement[];

                let best: HTMLElement | null = null;
                let bestDist = Number.POSITIVE_INFINITY;
                for (const raw of embeds) {
                    const embed = (raw.closest('.cm-embed-block') as HTMLElement | null) ?? raw;
                    const rect = embed.getBoundingClientRect();
                    if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
                        const centerY = (rect.top + rect.bottom) / 2;
                        const dist = Math.abs(centerY - e.clientY);
                        if (dist < bestDist) {
                            bestDist = dist;
                            best = embed;
                        }
                    }
                }

                return best;
            }

            clampNumber(value: number, min: number, max: number): number {
                if (value < min) return min;
                if (value > max) return max;
                return value;
            }

            destroy(): void {
                if (this.observer) {
                    this.observer.disconnect();
                }
                if (this.onScrollOrResize) {
                    this.view.scrollDOM.removeEventListener('scroll', this.onScrollOrResize);
                    window.removeEventListener('resize', this.onScrollOrResize);
                }
                if (this.onDeactivate) {
                    this.view.dom.removeEventListener('mouseleave', this.onDeactivate);
                    window.removeEventListener('blur', this.onDeactivate);
                }
                for (const [embedEl, entry] of this.embedHandles.entries()) {
                    embedEl.removeEventListener('mouseenter', entry.show);
                    embedEl.removeEventListener('mouseleave', entry.hide);
                    entry.handle.removeEventListener('mouseenter', entry.show);
                    entry.handle.removeEventListener('mouseleave', entry.hide);
                    entry.handle.remove();
                }
                this.embedHandles.clear();
            }
        },
        {
            decorations: (v) => v.decorations,
        }
    );
}

/**
 * 创建拖拽手柄编辑器扩展
 */
export function dragHandleExtension(plugin: DragNDropPlugin): Extension {
    return [createDragHandleViewPlugin(plugin)];
}
