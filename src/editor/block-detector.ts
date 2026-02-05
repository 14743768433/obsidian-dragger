import { EditorState, Text } from '@codemirror/state';
import { BlockType, BlockInfo } from '../types';

/**
 * 检测指定行的块类型
 */
export function detectBlockType(lineText: string): BlockType {
    const trimmed = lineText.trimStart();

    // 标题
    if (/^#{1,6}\s/.test(trimmed)) {
        return BlockType.Heading;
    }

    // 列表项（无序列表、有序列表、任务列表）
    if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed) || /^[-*+]\s\[[ x]\]/.test(trimmed)) {
        return BlockType.ListItem;
    }

    // 代码块开始
    if (/^```/.test(trimmed)) {
        return BlockType.CodeBlock;
    }

    // 引用块
    if (/^>/.test(trimmed)) {
        return BlockType.Blockquote;
    }

    // 表格（以|开头）
    if (/^\|/.test(trimmed)) {
        return BlockType.Table;
    }

    // 水平分隔线
    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
        return BlockType.HorizontalRule;
    }

    // 空行或普通段落
    if (trimmed.length === 0) {
        return BlockType.Unknown;
    }

    return BlockType.Paragraph;
}

/**
 * 获取行的缩进级别
 */
export function getIndentLevel(lineText: string): number {
    const match = lineText.match(/^(\s*)/);
    if (!match) return 0;

    const spaces = match[1];
    // 假设2个空格或1个tab为一级缩进
    return Math.floor(spaces.replace(/\t/g, '  ').length / 2);
}

/**
 * 检测块的完整范围（包括多行块如代码块）
 */
export function detectBlock(state: EditorState, lineNumber: number): BlockInfo | null {
    const doc = state.doc;

    if (lineNumber < 1 || lineNumber > doc.lines) {
        return null;
    }

    const line = doc.line(lineNumber);
    const lineText = line.text;
    const blockType = detectBlockType(lineText);

    if (blockType === BlockType.Unknown) {
        return null;
    }

    let startLine = lineNumber;
    let endLine = lineNumber;

    // 代码块：找到结束的```
    if (blockType === BlockType.CodeBlock && lineText.trimStart().startsWith('```')) {
        for (let i = lineNumber + 1; i <= doc.lines; i++) {
            const nextLine = doc.line(i);
            if (nextLine.text.trimStart().startsWith('```')) {
                endLine = i;
                break;
            }
        }
    }

    // 列表项：包含其子项
    if (blockType === BlockType.ListItem) {
        const currentIndent = getIndentLevel(lineText);
        for (let i = lineNumber + 1; i <= doc.lines; i++) {
            const nextLine = doc.line(i);
            const nextText = nextLine.text;

            // 空行可能是列表的一部分
            if (nextText.trim().length === 0) {
                continue;
            }

            const nextIndent = getIndentLevel(nextText);
            const nextType = detectBlockType(nextText);

            // 如果下一行缩进更深且是列表项，则属于当前块
            if (nextIndent > currentIndent && nextType === BlockType.ListItem) {
                endLine = i;
            } else {
                break;
            }
        }
    }

    // 引用块：连续的>行
    if (blockType === BlockType.Blockquote) {
        for (let i = lineNumber + 1; i <= doc.lines; i++) {
            const nextLine = doc.line(i);
            if (nextLine.text.trimStart().startsWith('>')) {
                endLine = i;
            } else {
                break;
            }
        }
    }

    // 表格：连续的|行
    if (blockType === BlockType.Table) {
        for (let i = lineNumber + 1; i <= doc.lines; i++) {
            const nextLine = doc.line(i);
            if (nextLine.text.trimStart().startsWith('|')) {
                endLine = i;
            } else {
                break;
            }
        }
    }

    const startLineObj = doc.line(startLine);
    const endLineObj = doc.line(endLine);

    // 收集块内容
    let content = '';
    for (let i = startLine; i <= endLine; i++) {
        content += doc.line(i).text;
        if (i < endLine) content += '\n';
    }

    return {
        type: blockType,
        startLine: startLine - 1, // 转为0-indexed
        endLine: endLine - 1,
        from: startLineObj.from,
        to: endLineObj.to,
        indentLevel: getIndentLevel(lineText),
        content,
    };
}

/**
 * 获取文档中所有块的信息
 */
export function getAllBlocks(state: EditorState): BlockInfo[] {
    const blocks: BlockInfo[] = [];
    const doc = state.doc;
    let currentLine = 1;

    while (currentLine <= doc.lines) {
        const block = detectBlock(state, currentLine);
        if (block) {
            blocks.push(block);
            currentLine = block.endLine + 2; // 跳过已处理的行（转回1-indexed）
        } else {
            currentLine++;
        }
    }

    return blocks;
}
