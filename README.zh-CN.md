<p align=\ center\>
  <a href=\README.md\><img src=\https://img.shields.io/badge/English-README-blue?style=flat-square\ alt=\English\ /></a>
  <a href=\README.zh-CN.md\><img src=\https://img.shields.io/badge/中文-说明-orange?style=flat-square\ alt=\中文\ /></a>
</p>

# Dragger（Obsidian 插件）

拖拽任意块（段落、标题、列表、引用、Callout、表格、数学块等），像 Notion 一样重新排列内容。

---

## 功能
- 拖拽块级内容：段落 / 标题 / 列表 / 任务 / 引用 / Callout / 表格 / 数学块
- 嵌套拖拽：横向位置决定嵌套层级，纵向位置决定插入行
- 手柄颜色与定位线颜色可配置
- 手柄可常态显示
- 跨文件拖拽（实验性）

---

## 安装

### 社区插件
若已上架：在 Obsidian 中打开 **设置 → 第三方插件 → 浏览**，搜索 **Dragger** 并安装。

### BRAT（Beta 测试）
1. 安装 BRAT 插件
2. 在 BRAT 中添加你的仓库地址
3. 选择最新 Release 安装

### 手动安装
将 Release 里的 main.js、manifest.json、styles.css（如有）放到：
`
.obsidian/plugins/dragger
`
然后在 Obsidian 启用插件。

---

## 使用
- 悬停在块左侧出现拖拽手柄（可设置为常驻显示）
- 拖动手柄到目标位置，看到定位线/高亮后松开
- 嵌套列表/引用：横向位置决定嵌套深度

---

## 设置
- **抓取手柄颜色**：跟随主题色或自定义
- **始终显示拖拽手柄**
- **定位栏颜色**：跟随主题色或自定义
- **跨文件拖拽**（实验性）

---

## 兼容性
- 需要 Obsidian >= 1.0.0
- 仅桌面端（isDesktopOnly: true）

---

## 开发
`
npm install
npm run dev
`

构建 Release：
`
npm run build
`

---

## 许可
MIT
