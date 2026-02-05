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

            constructor(view: EditorView) {
                this.decorations = this.buildDecorations(view);
                this.setupDropListeners(view);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = this.buildDecorations(update.view);
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

            setupDropListeners(view: EditorView): void {
                const editorDom = view.dom;

                // 必须在dragenter时也设置dropEffect来防止光标闪烁
                editorDom.addEventListener('dragenter', (e: DragEvent) => {
                    e.preventDefault();
                    if (e.dataTransfer) {
                        e.dataTransfer.dropEffect = 'move';
                    }
                });

                editorDom.addEventListener('dragover', (e: DragEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!e.dataTransfer) return;

                    e.dataTransfer.dropEffect = 'move';

                    // 显示放置指示器
                    this.showDropIndicator(view, e);
                });

                editorDom.addEventListener('dragleave', (e: DragEvent) => {
                    // 只有当离开编辑器区域时才隐藏指示器
                    const rect = editorDom.getBoundingClientRect();
                    if (e.clientX < rect.left || e.clientX > rect.right ||
                        e.clientY < rect.top || e.clientY > rect.bottom) {
                        this.hideDropIndicator();
                    }
                });

                editorDom.addEventListener('drop', (e: DragEvent) => {
                    e.preventDefault();
                    if (!e.dataTransfer) return;

                    const blockDataStr = e.dataTransfer.getData('application/dnd-block');
                    if (!blockDataStr) return;

                    const sourceBlock: BlockInfo = JSON.parse(blockDataStr);
                    const targetPos = view.posAtCoords({ x: e.clientX, y: e.clientY });

                    if (targetPos === null) return;

                    this.moveBlock(view, sourceBlock, targetPos);
                    this.hideDropIndicator();
                });
            }

            showDropIndicator(view: EditorView, e: DragEvent): void {
                this.hideDropIndicator();

                const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
                if (pos === null) return;

                let line = view.state.doc.lineAt(pos);
                let showAtBottom = false;

                // 检测当前行是否在代码块或引用块内部
                const blockAtPos = detectBlock(view.state, line.number);

                // 如果在多行块（代码块、引用块、表格）内部，将指示器移到块边界
                if (blockAtPos && (blockAtPos.type === BlockType.CodeBlock ||
                    blockAtPos.type === BlockType.Blockquote ||
                    blockAtPos.type === BlockType.Table)) {

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
                        } else {
                            line = blockEndLine;
                            showAtBottom = true;
                        }
                    }
                }

                const coords = showAtBottom
                    ? view.coordsAtPos(line.to)
                    : view.coordsAtPos(line.from);
                if (!coords) return;

                const editorRect = view.dom.getBoundingClientRect();
                const indicatorY = showAtBottom ? coords.bottom : coords.top;

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
            }

            moveBlock(view: EditorView, sourceBlock: BlockInfo, targetPos: number): void {
                const doc = view.state.doc;
                const targetLine = doc.lineAt(targetPos);

                // 检测目标位置是否在多行块内部，如果是则调整到块边界
                const targetBlock = detectBlock(view.state, targetLine.number);
                let targetLineNumber = targetLine.number;

                if (targetBlock && (targetBlock.type === BlockType.CodeBlock ||
                    targetBlock.type === BlockType.Blockquote ||
                    targetBlock.type === BlockType.Table)) {
                    // 使用块的边界
                    if (targetLine.number - 1 <= (targetBlock.startLine + targetBlock.endLine) / 2) {
                        targetLineNumber = targetBlock.startLine + 1;
                    } else {
                        targetLineNumber = targetBlock.endLine + 2; // 插入到块后面
                    }
                }

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

                // CodeMirror 的 changes 数组位置都是基于原始文档的，不需要手动计算偏移
                // 但必须按照从后到前的顺序排列 changes（位置大的在前）
                if (targetLineIdx < sourceBlock.startLine) {
                    // 向上移动
                    const targetLineObj = doc.line(targetLineIdx + 1);
                    const insertPos = targetLineObj.from;

                    // 删除源块（包括换行符）
                    const deleteFrom = sourceFrom;
                    const deleteTo = Math.min(sourceTo + 1, doc.length);

                    view.dispatch({
                        changes: [
                            // 必须按位置从大到小排序
                            { from: deleteFrom, to: deleteTo },  // 删除原位置
                            { from: insertPos, to: insertPos, insert: sourceContent + '\n' },  // 插入到目标位置
                        ].sort((a, b) => b.from - a.from),
                        scrollIntoView: false,
                    });
                } else {
                    // 向下移动
                    const targetLineObj = doc.line(Math.min(targetLineIdx + 1, doc.lines));
                    const insertPos = targetLineObj.from;

                    // 删除源块（包括换行符）
                    const deleteFrom = sourceFrom;
                    const deleteTo = Math.min(sourceTo + 1, doc.length);

                    view.dispatch({
                        changes: [
                            // 必须按位置从大到小排序
                            { from: insertPos, to: insertPos, insert: sourceContent + '\n' },  // 插入到目标位置
                            { from: deleteFrom, to: deleteTo },  // 删除原位置
                        ].sort((a, b) => b.from - a.from),
                        scrollIntoView: false,
                    });
                }

                console.log('Block moved');
            }

            destroy(): void {
                // 清理
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
