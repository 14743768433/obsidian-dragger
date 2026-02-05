<p align=\ center\>
  <a href=\README.md\><img src=\https://img.shields.io/badge/English-README-blue?style=flat-square\ alt=\English\ /></a>
  <a href=\README.zh-CN.md\><img src=\https://img.shields.io/badge/中文-说明-orange?style=flat-square\ alt=\中文\ /></a>
</p>

# Dragger (Obsidian Plugin)

Drag any block (paragraphs, headings, lists, blockquotes, callouts, tables, math blocks, etc.) to rearrange content like Notion.

---

## Features
- Drag block-level content: paragraphs / headings / lists / tasks / blockquotes / callouts / tables / math blocks
- Nested drag: horizontal position controls nesting level, vertical position controls insertion row
- Configurable handle color and indicator color
- Always-show handles option
- Cross-file drag (experimental)

---

## Installation

### Community Plugins
If published: open **Settings → Community plugins → Browse**, search **Dragger**, and install.

### BRAT (Beta)
1. Install BRAT
2. Add your repository URL in BRAT
3. Install the latest Release

### Manual
Copy main.js, manifest.json, and styles.css (if present) into:
`
.obsidian/plugins/dragger
`
Then enable the plugin in Obsidian.

---

## Usage
- Hover on the left side of a block to reveal the handle (or keep it always visible)
- Drag the handle to the target position and release when the indicator shows
- For nested lists/quotes, horizontal position determines nesting depth

---

## Settings
- **Handle color**: follow theme or custom
- **Always show handles**
- **Indicator color**: follow theme or custom
- **Cross-file drag** (experimental)

---

## Compatibility
- Requires Obsidian >= 1.0.0
- Desktop only (isDesktopOnly: true)

---

## Development
`
npm install
npm run dev
`

Build release:
`
npm run build
`

---

## License
MIT
