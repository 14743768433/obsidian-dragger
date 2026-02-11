[![English](https://img.shields.io/badge/lang-English-blue)](README.md) [![中文](https://img.shields.io/badge/lang-中文-red)](README.zh-CN.md)

# Dragger

**Drag and drop any block to rearrange content in Obsidian — just like Notion.**

![Obsidian](https://img.shields.io/badge/Obsidian-%3E%3D1.0.0-7c3aed?logo=obsidian&logoColor=white) ![License](https://img.shields.io/github/license/Ariestar/obsidian-dragger) ![Release](https://img.shields.io/github/v/release/Ariestar/obsidian-dragger)

<!-- TODO: Record a demo GIF with ScreenToGif (<5 MB) and replace this comment -->

## Features

- 🧱 **Block-level drag & drop** — paragraphs, headings, lists, tasks, blockquotes, callouts, tables, code blocks, math blocks
- 📐 **Nested drag** — horizontal position controls indent level; vertical position controls insertion row
- 🔗 **Multi-line selection drag** — long-press or click to select a range, then drag as a group
- 🎨 **Customizable handles** — 4 icon styles (dot / grip-dots / grip-lines / square), adjustable size, color, and horizontal offset
- 📍 **Visual drop indicator** — glowing line shows exactly where the block will land
- 📱 **Mobile support** — works on Android (tested)

## Installation

### Community Plugins

Open **Settings → Community plugins → Browse**, search **Dragger**, and install.

### BRAT (Beta)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. In BRAT settings, click **Add Beta Plugin** and enter:
   ```
   Ariestar/obsidian-dragger
   ```
3. Enable the plugin in **Settings → Community plugins**

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Ariestar/obsidian-dragger/releases), then copy them into:

```
<your-vault>/.obsidian/plugins/dragger/
```

Restart Obsidian and enable the plugin.

## Usage

1. **Hover** on the left edge of any block to reveal the drag handle
2. **Drag** the handle to the target position — a glowing indicator shows where the block will be inserted
3. **Release** to drop the block into place

**Nested lists & blockquotes:** move the cursor horizontally while dragging to control indent level.

**Multi-line selection:** long-press (touch) or click multiple handles to select a range, then drag the entire selection.

> 💡 **Tip:** Enable line numbers in Obsidian settings for a better experience — the handle appears right at the line-number gutter.

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Handle color** | Follow theme accent or pick a custom color | Theme |
| **Handle visibility** | Hover / Always visible / Hidden | Hover |
| **Handle icon** | ● Dot / ⠿ Grip-dots / ☰ Grip-lines / ■ Square | Dot |
| **Handle size** | 12 – 28 px | 16 px |
| **Handle horizontal offset** | Shift handle left (−80) or right (+80) px | 0 px |
| **Indicator color** | Follow theme accent or pick a custom color | Theme |
| **Multi-line selection** | Enable range-select-then-drag workflow | On |

## Compatibility

- Obsidian **≥ 1.0.0**
- Desktop (Windows, macOS, Linux) + Mobile (Android tested)

## Development

```bash
npm install
npm run dev       # watch mode with hot reload
npm run build     # production build
npm run test      # run Vitest suite (116 tests)
npm run typecheck # TypeScript type checking
```

## License

[MIT](LICENSE)

## Contributing

PRs and issues are welcome!

If this plugin helps you, a ⭐ on GitHub would mean a lot.
