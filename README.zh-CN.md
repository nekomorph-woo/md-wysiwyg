# md-wysiwyg

[English README](./README.md)

`md-wysiwyg` 是一个基于 Milkdown 的 Pulsar Markdown 所见即所得编辑器。

它会默认以渲染后的 WYSIWYG 模式打开 Markdown 文件，同时仍然把原始 Markdown 文本作为最终存储内容。它适合本地笔记、技术文档、插件设计文档等场景，让标题、列表、表格、图片、数学公式、Mermaid 图和 callout 都能直接在渲染视图里编辑。

## 功能特性

- 默认以 WYSIWYG 模式打开 `.md` 文件，并支持 `Alt+W` 在渲染模式和源码模式之间切换。
- 顶部工具栏支持标题、加粗、斜体、行内代码、链接、列表、引用、callout、代码块、Mermaid、表格、图片、数学公式、搜索和图片资产管理。
- 支持 `/` slash command，用来快速插入常见 Markdown 块。
- 支持 GitHub Flavored Markdown，包括表格、任务列表、删除线和脚注。
- 任务列表 checkbox 可直接点击，并同步更新底层 Markdown 中的 `[ ]` / `[x]`。
- 链接编辑浮窗支持修改链接文字、URL 和 title。
- 代码块支持语言选择和语法高亮。
- Mermaid 图表块支持源码/预览切换和删除。
- 行内数学公式和块级数学公式使用 KaTeX 渲染。
- 支持 YAML front matter 的展示与编辑。
- 支持基于标题的大纲导航，并可手动收起。
- 支持文档字数、字符数、段落数和预计阅读时间统计。
- 支持 WYSIWYG 模式内搜索与替换，包括命中高亮、上一个/下一个跳转、替换当前项和全部替换确认。
- 支持本地图片粘贴、拖拽、剪贴板图片数据和截图图片数据落盘。
- 图片资产管理器支持预览图片、复制路径、清理未引用资源、查看引用文档和删除资源。
- 支持相对路径和绝对路径本地图片预览。

## 安装

本地开发安装方式：

```sh
cd /path/to/md-wysiwyg
pulsar -p install
pulsar -p link --dev
pulsar --dev /path/to/your/markdown/project
```

然后打开 Markdown 文件。如果插件已启用，并且配置项 `Open Markdown Files as WYSIWYG` 保持开启，Markdown 文件会默认进入渲染编辑模式。

修改插件代码或重新 build 后，可以在 Pulsar 中使用 `Cmd+Shift+F5`，或执行 `Window: Reload` 命令重载窗口。

## 使用说明

### 模式切换

- `Alt+W`：在 WYSIWYG 模式和 Markdown 源码模式之间切换。
- Markdown 文件默认以 WYSIWYG 模式打开。如果你希望默认先进入源码模式，可以在插件设置中关闭该选项。

### 编辑内容

可以通过顶部工具栏或 slash command 插入和转换 Markdown 内容。

在编辑器中输入 `/` 会打开命令菜单。当前支持标题、列表、任务列表、表格、图片、数学公式、脚注、引用、callout、代码块、Mermaid 图和分割线等。

### 链接

- macOS 使用 `Cmd+K`，Windows/Linux 使用 `Ctrl+K` 打开链接编辑器。
- 链接编辑器可以修改链接文字、URL、title，也可以移除链接或在外部浏览器打开链接。

### 搜索与替换

- `Alt+F`：打开 WYSIWYG 搜索。
- `Alt+R`：打开 WYSIWYG 替换。
- 上一个/下一个会自动滚动到当前命中内容。
- 全部替换前会进行确认。

这里刻意使用 `Alt` 系列快捷键，避免覆盖 Pulsar 原生的 `Cmd/Ctrl+F` 查找体验。

### 图片

图片可以通过工具栏插入，也可以从剪贴板粘贴、从文件系统拖拽，或从截图这类剪贴板图片数据创建。

粘贴和拖拽得到的图片会被复制到配置的图片资产目录中。Markdown 文档中保存图片路径，WYSIWYG 视图会基于当前文档解析并预览图片。

点击图片会打开一个紧凑的浮动编辑条：

- `src`：Markdown 图片路径。
- `alt`：图片替代文本。
- `title`：可选图片标题。
- `Apply`：更新图片节点。
- `Delete`：从文档中删除这个图片节点。

### 图片资产管理

可以通过顶部工具栏的 `Assets` 按钮，或 Pulsar 菜单中的 `Manage Image Assets` 打开图片资产管理器。

资产管理器支持：

- 展示资产目录中的所有图片；
- 预览图片；
- 复制图片路径，方便手动写入 Markdown；
- 查看哪些 Markdown 文档引用了某张图片；
- 清理未引用图片；
- 删除图片资源，并在被引用时给出提醒。

引用统计按文档去重：同一个 Markdown 文档即使多次使用同一张图片，也只算一次引用。

### Mermaid

Mermaid 代码块会渲染为图表，并提供显式的 `Source` / `Preview` 控制。已有文档在 WYSIWYG 模式中默认偏向预览；新插入的 Mermaid 块更偏向先编辑源码。

### 表格

表格支持插入、增加/删除行、增加/删除列、删除整表、列对齐，以及在单元格之间通过键盘移动。

## 配置项

可以在 Pulsar 的 `md-wysiwyg` 插件设置中调整配置。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `editorMaxWidth` | `900` | 编辑器正文区域最大宽度，单位为像素。 |
| `fontSize` | `0` | 自定义编辑器字号，单位为像素。`0` 表示使用主题默认字号。 |
| `openMarkdownAsWysiwyg` | `true` | 是否默认以 WYSIWYG 模式打开 Markdown 文件。 |
| `assetsDirectory` | 空 | 粘贴、拖拽、截图图片的资产目录。留空时使用系统图片目录下的 `md-wysiwyg-assets`。 |
| `mermaidRenderDelay` | `500` | Mermaid 图渲染前的 debounce 延迟，单位为毫秒。 |
| `allowUnsafeRendering` | `false` | 允许可信本地文档使用更宽松的 KaTeX 和 Mermaid 渲染能力。 |

默认图片资产目录：

- macOS：`~/Pictures/md-wysiwyg-assets`
- Windows：`%USERPROFILE%\Pictures\md-wysiwyg-assets`
- Linux：优先 `~/Pictures/md-wysiwyg-assets`，不存在时使用 `~/md-wysiwyg-assets`

## 快捷键

| 快捷键 | 作用范围 | 命令 |
| --- | --- | --- |
| `Alt+W` | 工作区、源码编辑器、WYSIWYG 编辑器 | 切换 WYSIWYG/源码模式 |
| `Cmd+K` / `Ctrl+K` | WYSIWYG 编辑器 | 编辑链接 |
| `Cmd+C` / `Ctrl+C` | WYSIWYG 编辑器 | 复制选中的 WYSIWYG 文本 |
| `Cmd+X` / `Ctrl+X` | WYSIWYG 编辑器 | 剪切选中的 WYSIWYG 文本 |
| `Cmd+V` / `Ctrl+V` | WYSIWYG 编辑器 | 粘贴文本，或将剪贴板图片数据落盘并插入 |
| `Alt+F` | WYSIWYG 编辑器 | 搜索 |
| `Alt+R` | WYSIWYG 编辑器 | 替换 |

## 开发

安装依赖并构建 Milkdown 和 Mermaid runtime：

```sh
npm install
npm run build
```

提交前建议执行：

```sh
node --check lib/md-wysiwyg.js
node --check lib/image-assets.js
node --check milkdown-plugins/image.js
node --check milkdown-plugins/search-replace.js
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); JSON.parse(require('fs').readFileSync('keymaps/md-wysiwyg.json','utf8')); JSON.parse(require('fs').readFileSync('menus/md-wysiwyg.json','utf8'))"
git diff --check
```

`lib/milkdown-bundle.cjs` 和 `lib/mermaid-bundle.cjs` 由构建脚本生成，并由 Pulsar 运行时加载。

## 注意事项

- 本插件面向 Pulsar 的 Atom 兼容插件 API。
- Markdown 仍然是最终持久化格式，WYSIWYG 交互会更新底层 Markdown 文档。
- `allowUnsafeRendering` 只建议对可信本地文档开启。
