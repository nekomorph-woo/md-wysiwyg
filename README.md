# md-wysiwyg

[中文文档](./README.zh-CN.md)

A Milkdown-powered WYSIWYG Markdown editor for Pulsar.

`md-wysiwyg` opens Markdown files in a rendered editing surface by default, while keeping the original Markdown text as the source of truth. It is designed for local note-taking and documentation work where headings, lists, tables, images, math, Mermaid diagrams, and callouts should be editable without constantly switching back to raw Markdown.

## Features

- Opens `.md` files directly in WYSIWYG mode, with `Alt+W` to switch between rendered mode and source mode.
- Toolbar controls for headings, bold, italic, inline code, links, lists, blockquotes, callouts, code blocks, Mermaid, tables, images, math, search, and image assets.
- Slash command menu for quickly inserting common Markdown blocks.
- GitHub Flavored Markdown support, including tables, task lists, strikethrough, and footnotes.
- Clickable task-list checkboxes that update the underlying Markdown.
- Link editing popover with text, URL, and title fields.
- Code blocks with language selection and syntax highlighting.
- Mermaid diagram blocks with source/preview controls and a delete action.
- Inline and block math rendered with KaTeX.
- YAML front matter display and editing.
- Floating outline navigation for document headings, with collapse support.
- Inline document stats for words, characters, paragraphs, and estimated reading time.
- WYSIWYG search and replace with match highlighting, next/previous navigation, and replace-all confirmation.
- Local image handling for pasted, dropped, copied, and screenshot image data.
- Image asset manager for previewing assets, copying paths, cleaning unused files, viewing references, and deleting assets.
- Relative and absolute local image path preview support.

## Installation

For local development in Pulsar:

```sh
cd /path/to/md-wysiwyg
pulsar -p install
pulsar -p link --dev
pulsar --dev /path/to/your/markdown/project
```

Then open a Markdown file. If the package is active and `Open Markdown Files as WYSIWYG` is enabled, the file opens in rendered editing mode.

Use `Cmd+Shift+F5` on macOS, or the Pulsar `Window: Reload` command, after rebuilding or changing package code.

## Usage

### Mode Switching

- `Alt+W`: toggle between WYSIWYG mode and Markdown source mode.
- Markdown files open in WYSIWYG mode by default. Disable this in package settings if you prefer source mode first.

### Editing

Use the toolbar or slash command menu to insert and transform Markdown content.

The slash command menu opens by typing `/` in the editor. It supports headings, lists, task lists, tables, images, math, footnotes, quotes, callouts, code blocks, Mermaid diagrams, and dividers.

### Links

- `Cmd+K` on macOS or `Ctrl+K` on Windows/Linux opens the link editor.
- The link editor can update link text, URL, and title, remove the link, or open the URL externally.

### Search And Replace

- `Alt+F`: open WYSIWYG find.
- `Alt+R`: open WYSIWYG replace.
- Next and previous navigation scrolls the active match into view.
- Replace-all asks for confirmation before editing the document.

These shortcuts intentionally use the `Alt` family so Pulsar's native `Cmd/Ctrl+F` source search remains available outside WYSIWYG search.

### Images

Images can be inserted from the toolbar, pasted from the clipboard, dropped from the file system, or created from clipboard image data such as screenshots.

Pasted and dropped images are copied into the configured asset directory. The Markdown stores a path to the local asset, and the WYSIWYG view resolves the preview against the current document.

Click an image to open a compact floating editor for:

- `src`: the Markdown image path.
- `alt`: alternate text.
- `title`: optional image title.
- `Apply`: update the image node.
- `Delete`: remove the image node from the document.

### Image Assets

Open the asset manager from the toolbar `Assets` button or the package menu.

The asset manager can:

- show all images in the asset directory;
- preview an image;
- copy the image path for use in Markdown;
- show which Markdown documents reference an asset;
- clean unused assets;
- delete an asset, with a reference warning when applicable.

A single Markdown document counts once per image reference summary, even if it uses the same image multiple times.

### Mermaid

Mermaid blocks render diagrams in preview mode and provide explicit source/preview controls. WYSIWYG mode defaults to preview for existing Mermaid blocks; inserted Mermaid blocks are intended to be edited from source first.

### Tables

Tables support insertion, row and column operations, deletion, alignment controls, and keyboard movement between cells.

## Configuration

Package settings are available under Pulsar's package settings for `md-wysiwyg`.

| Setting | Default | Description |
| --- | --- | --- |
| `editorMaxWidth` | `900` | Maximum width of the editor content area in pixels. |
| `fontSize` | `0` | Custom editor font size in pixels. `0` uses the active theme default. |
| `openMarkdownAsWysiwyg` | `true` | Open Markdown files in WYSIWYG mode by default. |
| `assetsDirectory` | empty | Directory for pasted, dropped, and screenshot image assets. Empty uses the system Pictures folder with `md-wysiwyg-assets`. |
| `mermaidRenderDelay` | `500` | Debounce delay before rendering Mermaid diagrams. |
| `allowUnsafeRendering` | `false` | Allows trusted KaTeX commands and Mermaid loose security mode for trusted local documents. |

Default image asset directory:

- macOS: `~/Pictures/md-wysiwyg-assets`
- Windows: `%USERPROFILE%\Pictures\md-wysiwyg-assets`
- Linux: `~/Pictures/md-wysiwyg-assets` when available, otherwise `~/md-wysiwyg-assets`

## Keyboard Shortcuts

| Shortcut | Scope | Command |
| --- | --- | --- |
| `Alt+W` | Workspace, source editor, WYSIWYG editor | Toggle WYSIWYG/source mode |
| `Cmd+K` / `Ctrl+K` | WYSIWYG editor | Edit link |
| `Cmd+C` / `Ctrl+C` | WYSIWYG editor | Copy selected WYSIWYG text |
| `Cmd+X` / `Ctrl+X` | WYSIWYG editor | Cut selected WYSIWYG text |
| `Cmd+V` / `Ctrl+V` | WYSIWYG editor | Paste text or localize clipboard image data |
| `Alt+F` | WYSIWYG editor | Find |
| `Alt+R` | WYSIWYG editor | Replace |

## Development

Install dependencies and build the bundled Milkdown and Mermaid runtime:

```sh
npm install
npm run build
```

Useful checks before committing:

```sh
node --check lib/md-wysiwyg.js
node --check lib/image-assets.js
node --check milkdown-plugins/image.js
node --check milkdown-plugins/search-replace.js
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); JSON.parse(require('fs').readFileSync('keymaps/md-wysiwyg.json','utf8')); JSON.parse(require('fs').readFileSync('menus/md-wysiwyg.json','utf8'))"
git diff --check
```

`lib/milkdown-bundle.cjs` and `lib/mermaid-bundle.cjs` are generated by the build scripts and are loaded by Pulsar at runtime.

## Notes

- This package targets Pulsar's Atom-compatible package API.
- Markdown remains the persistence format. WYSIWYG interactions update the Markdown document.
- `allowUnsafeRendering` should only be enabled for trusted local documents.
