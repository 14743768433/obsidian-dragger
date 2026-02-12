import { moment } from 'obsidian';

const zh = {
    // Headings
    headingAppearance: '样式',
    headingBehavior: '功能',

    // Handle color
    handleColor: '手柄颜色',
    handleColorDesc: '跟随主题强调色或自定义颜色',
    optionTheme: '跟随主题色',
    optionCustom: '自定义',

    // Handle visibility
    handleVisibility: '手柄显示模式',
    handleVisibilityDesc: '控制拖拽手柄的显示方式',
    optionHover: '悬停显示',
    optionAlways: '始终显示',
    optionHidden: '隐藏',

    // Handle icon
    handleIcon: '手柄图标',
    handleIconDesc: '选择拖拽手柄的图标样式',
    iconDot: '● 圆点',
    iconGripDots: '⠿ 六点抓手',
    iconGripLines: '☰ 三横线',
    iconSquare: '■ 方块',

    // Handle size
    handleSize: '手柄大小',
    handleSizeDesc: '调整拖拽手柄的大小（像素）',

    // Handle offset
    handleOffset: '手柄横向位置',
    handleOffsetDesc: '向左为负值，向右为正值',

    // Selection highlight color
    selectionHighlightColor: '选中高亮颜色',
    selectionHighlightColorDesc: '选中块时行背景光晕的颜色',

    // Indicator color
    indicatorColor: '指示器颜色',
    indicatorColorDesc: '跟随主题强调色或自定义颜色',

    // Multi-line selection
    multiLineSelection: '多行选取',
    multiLineSelectionDesc: '关闭后仅保留单块拖拽，不进入多行选取流程',

    // Align handle to line number
    alignHandleToLineNumber: '手柄对齐行号',
    alignHandleToLineNumberDesc: '关闭后即使显示行号，手柄也定位到编辑器左侧边缘',
};

const en: typeof zh = {
    headingAppearance: 'Appearance',
    headingBehavior: 'Behavior',

    handleColor: 'Handle color',
    handleColorDesc: 'Follow theme accent or pick a custom color',
    optionTheme: 'Theme',
    optionCustom: 'Custom',

    handleVisibility: 'Handle visibility',
    handleVisibilityDesc: 'Control how drag handles are displayed',
    optionHover: 'Hover',
    optionAlways: 'Always',
    optionHidden: 'Hidden',

    handleIcon: 'Handle icon',
    handleIconDesc: 'Choose the icon style for drag handles',
    iconDot: '● Dot',
    iconGripDots: '⠿ Grip dots',
    iconGripLines: '☰ Grip lines',
    iconSquare: '■ Square',

    handleSize: 'Handle size',
    handleSizeDesc: 'Adjust the size of drag handles (px)',

    handleOffset: 'Handle horizontal offset',
    handleOffsetDesc: 'Negative = left, positive = right',

    selectionHighlightColor: 'Selection highlight color',
    selectionHighlightColorDesc: 'Background glow color on selected blocks',

    indicatorColor: 'Indicator color',
    indicatorColorDesc: 'Follow theme accent or pick a custom color',

    multiLineSelection: 'Multi-line selection',
    multiLineSelectionDesc: 'Disable to keep single-block drag only',

    alignHandleToLineNumber: 'Align handle to line numbers',
    alignHandleToLineNumberDesc: 'When off, handles are positioned at the editor edge even if line numbers are visible',
};

export type I18nStrings = typeof zh;

export function t(): I18nStrings {
    const locale = moment.locale();
    return locale.startsWith('zh') ? zh : en;
}
