# Changelog

All notable changes to `md-wysiwyg` are documented here.

The package version in `package.json` is still `0.1.0`; the sections below track feature-branch milestones used during development.

## Unreleased

- Reworked the image editor control into a compact floating editor near the selected image.
- Fixed image editor input interactions so selecting text inside `src`, `alt`, and `title` fields does not drag the image node.
- Fixed `Apply` and `Delete` actions in the floating image editor.
- Improved image editor positioning so it stays inside the editor viewport instead of becoming a full-width bar.

## v0.6

### Added

- Added WYSIWYG search and replace.
- Added `Alt+F` for find and `Alt+R` for replace to avoid overriding Pulsar's native `Cmd/Ctrl+F`.
- Added match highlighting, active-match navigation, replace current, and replace-all confirmation.
- Added automatic scrolling to active search results when using previous/next.
- Added image asset directory support with configurable `assetsDirectory`.
- Added default cross-platform image asset directory handling:
  - macOS: `~/Pictures/md-wysiwyg-assets`
  - Windows: `%USERPROFILE%\Pictures\md-wysiwyg-assets`
  - Linux: `~/Pictures/md-wysiwyg-assets` or `~/md-wysiwyg-assets`
- Added image asset manager with refresh, preview, path copy, unused cleanup, reference display, and delete support.
- Added clipboard image handling for pasted screenshot/native image data.
- Added local image drag-and-drop handling that localizes images into the asset directory.
- Added relative and absolute local image path preview resolution.
- Added cache-busted image previews so deleted or changed assets do not keep stale previews.

### Changed

- Image asset reference counts are document-based: one Markdown document counts once even if it uses the same image multiple times.
- Image asset `Copy Path` now copies only the path, not a full Markdown image snippet.
- Image asset deletion warns when an asset is still referenced, then allows explicit deletion after confirmation.
- Search and replace state is scoped to WYSIWYG mode and closes cleanly when switching editor modes.
- Image preview handling now refreshes active image node views when assets change.

### Fixed

- Fixed dropped local images being intercepted by Pulsar's default file preview/open behavior.
- Fixed pasted clipboard image data not being inserted in WYSIWYG mode.
- Fixed search previous/next not scrolling to matches outside the visible viewport.
- Fixed stale deleted image previews remaining visible after asset deletion.
- Fixed inaccurate per-image reference lists caused by duplicate matches from the same Markdown document.

## v0.5

### Added

- Added floating document outline navigation based on headings.
- Added outline collapse behavior so the document content can reclaim horizontal space.
- Added document stats for words, characters, paragraphs, and estimated reading time.
- Added toolbar buttons for callout/admonition blocks:
  - `Note`
  - `Tip`
  - `Warn`

### Fixed

- Fixed outline behavior so it remains visible while the editor content scrolls.
- Fixed inline stats positioning so the stats remain at the editor viewport bottom-right while scrolling.

## v0.4

### Added

- Added enhanced Mermaid block editing with source/preview controls.
- Added Mermaid delete action.
- Added improved Mermaid rendering theme configuration.
- Added table editing controls:
  - add/delete row
  - add/delete column
  - delete table
  - column alignment
  - keyboard movement between cells
- Added image insertion from the toolbar.
- Added image edit controls for `src`, `alt`, and `title`.
- Added image delete action.
- Added improved link editing popover with explanatory field labels.
- Added plain arrow-key cursor movement handling in WYSIWYG mode.

### Fixed

- Fixed Mermaid source mode instability where blocks would unexpectedly return to preview.
- Fixed Mermaid preview clicks switching to source mode unintentionally.
- Fixed the link popover close button requiring focus to move elsewhere before closing.
- Fixed link popover apply behavior for link text, URL, and title updates.
- Fixed deprecated Pulsar editor scroll/height API usage by moving to view-element methods.
- Fixed image editor dismissal behavior after applying image settings.

## v0.3

### Added

- Added default WYSIWYG opening for Markdown files.
- Added `Alt+W` source/WYSIWYG mode switching.
- Added source-mode continuity so users can switch back to raw Markdown without losing edits.
- Added Mermaid rendering support for fenced `mermaid` code blocks.
- Added copy, cut, and paste support in WYSIWYG mode with macOS `Cmd` and Windows/Linux `Ctrl` shortcuts.

### Changed

- Mermaid blocks inserted for editing start from source-oriented interaction, while existing documents opened in WYSIWYG favor rendered preview.

## v0.2

### Added

- Added content-state safety around WYSIWYG/source switching.
- Added slash command menu for common Markdown insertions.
- Added Markdown toolbar actions for headings, emphasis, inline code, links, lists, quotes, code, Mermaid, tables, images, and math.
- Added link editing support.
- Added task-list checkbox interaction.
- Added table insertion groundwork.
- Added image insertion groundwork.
- Added math rendering groundwork.

### Fixed

- Fixed checkbox alignment for task lists.
- Fixed task-list checkbox toggling between `[ ]` and `[x]`.
- Fixed delete-key editing around inline text selections.

## v0.1.0

- Initial package scaffold.
- Added Pulsar package activation and basic Markdown WYSIWYG editor integration.
