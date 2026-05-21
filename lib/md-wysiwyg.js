'use babel';

const { CompositeDisposable } = require('atom');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const imageAssets = require('./image-assets');

const PROTOCOL = 'md-wysiwyg://';
const READ_WORDS_PER_MINUTE = 275;
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd']);

let milkdownModule = null;

function loadMilkdown() {
  if (milkdownModule) return milkdownModule;
  try {
    milkdownModule = require('./milkdown-bundle.cjs');
    console.log('md-wysiwyg: Milkdown bundle loaded');
    injectKatexCSS();
    injectHljsCSS();
    return milkdownModule;
  } catch (err) {
    console.error('md-wysiwyg: Milkdown bundle require failed', err);
    throw err;
  }
}

let katexCSSInjected = false;
function injectKatexCSS() {
  if (katexCSSInjected) return;
  katexCSSInjected = true;
  try {
    const pkg = atom.packages.getLoadedPackage('md-wysiwyg');
    const pkgPath = pkg && pkg.path ? pkg.path : path.dirname(path.dirname(__dirname));
    const katexDir = path.join(pkgPath, 'node_modules/katex/dist');
    const katexPath = path.join(katexDir, 'katex.min.css');
    let css = fs.readFileSync(katexPath, 'utf8');
    const katexURL = pathToFileURL(katexDir).href;
    css = css.replace(/url\(fonts\//g, 'url(' + katexURL + '/fonts/');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  } catch (err) {
    console.error('md-wysiwyg: KaTeX CSS injection failed', err);
  }
}

let hljsCSSInjected = false;
function injectHljsCSS() {
  if (hljsCSSInjected) return;
  hljsCSSInjected = true;
  try {
    const pkg = atom.packages.getLoadedPackage('md-wysiwyg');
    const pkgPath = pkg && pkg.path ? pkg.path : path.dirname(path.dirname(__dirname));
    const hljsDir = path.join(pkgPath, 'node_modules/highlight.js/styles');
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = pathToFileURL(path.join(hljsDir, 'atom-one-dark.min.css')).href;
    document.head.appendChild(style);
  } catch (err) {
    console.error('md-wysiwyg: highlight.js CSS injection failed', err);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function textOffsetForPosition(text, row, column) {
  const lines = text.split('\n');
  let offset = 0;
  const safeRow = clamp(row || 0, 0, Math.max(lines.length - 1, 0));
  for (let i = 0; i < safeRow; i++) offset += lines[i].length + 1;
  return offset + clamp(column || 0, 0, lines[safeRow] ? lines[safeRow].length : 0);
}

function positionForTextOffset(text, offset) {
  const safeOffset = clamp(offset || 0, 0, text.length);
  const before = text.slice(0, safeOffset);
  const lines = before.split('\n');
  return [lines.length - 1, lines[lines.length - 1].length];
}

function normalizeMarkdownLine(line) {
  return String(line || '')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*[-+*]\s+\[[ xX]\]\s+/, '')
    .replace(/^\s*[-+*]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/[*_`~[\]()!#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function scrollRatioForElement(element) {
  if (!element) return 0;
  const maxScroll = element.scrollHeight - element.clientHeight;
  if (maxScroll <= 0) return 0;
  return element.scrollTop / maxScroll;
}

function restoreElementScroll(element, ratio) {
  if (!element || typeof ratio !== 'number') return;
  const maxScroll = element.scrollHeight - element.clientHeight;
  if (maxScroll <= 0) return;
  element.scrollTop = maxScroll * clamp(ratio, 0, 1);
}

function getTextEditorElement(textEditor) {
  if (!textEditor) return null;
  if (textEditor.element) return textEditor.element;
  try {
    return atom.views.getView(textEditor);
  } catch (_err) {
    return null;
  }
}

function getTextEditorScrollInfo(textEditor) {
  const element = getTextEditorElement(textEditor);
  const scrollTop = element && element.getScrollTop ? element.getScrollTop() : 0;
  const scrollHeight = element && element.getScrollHeight ? element.getScrollHeight() : 0;
  const height = element && element.getHeight ? element.getHeight() : 0;
  return {
    scrollTop,
    scrollHeight,
    height,
    maxScroll: scrollHeight > height ? scrollHeight - height : 0,
  };
}

function setTextEditorScrollTop(textEditor, scrollTop) {
  const element = getTextEditorElement(textEditor);
  if (element && element.setScrollTop) {
    element.setScrollTop(scrollTop);
  }
}

function findTextBlockPosition(doc, anchorText) {
  const normalizedAnchor = normalizeMarkdownLine(anchorText);
  if (!normalizedAnchor) return null;

  let best = null;
  doc.descendants((node, pos) => {
    if (best != null || !node.isTextblock) return true;
    const normalizedNode = normalizeMarkdownLine(node.textContent);
    if (!normalizedNode) return true;
    const index = normalizedNode.indexOf(normalizedAnchor);
    if (index >= 0 || normalizedAnchor.indexOf(normalizedNode) >= 0) {
      best = pos + 1 + Math.max(index, 0);
      return false;
    }
    return true;
  });

  return best;
}

function findSourcePositionForAnchor(markdown, anchorText) {
  const normalizedAnchor = normalizeMarkdownLine(anchorText);
  if (!normalizedAnchor) return null;

  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const normalizedLine = normalizeMarkdownLine(lines[i]);
    if (!normalizedLine) continue;
    const index = normalizedLine.indexOf(normalizedAnchor);
    if (index >= 0 || normalizedAnchor.indexOf(normalizedLine) >= 0) {
      const rawIndex = lines[i].indexOf(anchorText);
      return [i, rawIndex >= 0 ? rawIndex : Math.max(lines[i].search(/\S/), 0)];
    }
  }

  return null;
}

function statsForText(text) {
  const normalized = String(text || '').trim();
  const cjkCount = (normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const wordCount = (normalized
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ')
    .match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  const count = cjkCount + wordCount;
  const characters = normalized.replace(/\s/g, '').length;
  const paragraphs = normalized
    ? normalized.split(/\n\s*\n/).filter((part) => part.trim().length > 0).length
    : 0;
  const readingMinutes = count > 0 ? Math.max(1, Math.ceil(count / READ_WORDS_PER_MINUTE)) : 0;

  return { count, characters, paragraphs, readingMinutes };
}

function formatStats(stats) {
  if (!stats) return '';
  const readTime = stats.readingMinutes > 0 ? stats.readingMinutes + ' min' : '<1 min';
  return stats.count + ' words · ' + stats.characters + ' chars · ' +
    stats.paragraphs + ' paras · ' + readTime;
}

function isMarkdownPath(filePath) {
  return Boolean(filePath && MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
}

function filePathFromUri(uri) {
  if (!uri || uri.startsWith(PROTOCOL)) return null;
  if (uri.startsWith('file://')) {
    try { return fileURLToPath(uri); } catch (_err) { return null; }
  }
  return path.isAbsolute(uri) ? uri : null;
}

function collectHeadings(doc) {
  const headings = [];
  if (!doc || !doc.descendants) return headings;

  doc.descendants((node, pos) => {
    if (node.type && node.type.name === 'heading') {
      const text = (node.textContent || '').trim() || 'Untitled heading';
      headings.push({
        pos,
        level: clamp(Number(node.attrs.level || 1), 1, 6),
        text,
      });
      return false;
    }
    return true;
  });

  return headings;
}

class MdWysiwygEditor {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.fileName = path.basename(filePath);
    this.emitter = new (require('atom').Emitter)();
    this.disposables = new (require('atom').CompositeDisposable)();
    this.modified = Boolean(options.modified);
    this.milkdownEditor = null;
    this.initialized = false;
    this.destroyed = false;
    this.initialContent = options.content;
    this.restoreNavigation = options.restoreNavigation || null;
    this.stats = statsForText(options.content || '');
    this.userChangePendingUntil = 0;
    this.userChangeListeners = [];
    this.linkPopoverRange = null;
    this.linkPopoverSuppression = null;
    this.outlineItems = [];
    this.outlineCollapsed = false;

    this.element = document.createElement('div');
    this.element.classList.add('md-wysiwyg-editor');
    this.element.setAttribute('data-file-path', filePath);
    this._observeUserChanges();

    this.toolbarElement = this._createToolbar();
    this.element.appendChild(this.toolbarElement);

    this.tableToolbarElement = this._createTableToolbar();
    this.element.appendChild(this.tableToolbarElement);

    this.mainElement = document.createElement('div');
    this.mainElement.classList.add('md-wysiwyg-main');
    this.element.appendChild(this.mainElement);

    this.outlineElement = this._createOutline();
    this.mainElement.appendChild(this.outlineElement);

    this.editorContainer = document.createElement('div');
    this.editorContainer.classList.add('milkdown-container');
    this.mainElement.appendChild(this.editorContainer);

    this.linkPopover = this._createLinkPopover();
    this.element.appendChild(this.linkPopover);

    this.statsElement = document.createElement('div');
    this.statsElement.classList.add('md-wysiwyg-inline-status');
    this.statsElement.setAttribute('aria-live', 'polite');
    this.element.appendChild(this.statsElement);

    const fontSize = atom.config.get('md-wysiwyg.fontSize');
    if (fontSize > 0) {
      this.editorContainer.style.fontSize = fontSize + 'px';
    }

    this.disposables.add(
      atom.config.observe('md-wysiwyg.fontSize', (val) => {
        this.editorContainer.style.fontSize = val > 0 ? val + 'px' : '';
      })
    );

    const editorMaxWidth = atom.config.get('md-wysiwyg.editorMaxWidth');
    if (editorMaxWidth > 0) {
      this.editorContainer.style.maxWidth = editorMaxWidth + 'px';
    }

    this.disposables.add(
      atom.config.observe('md-wysiwyg.editorMaxWidth', (val) => {
        this.editorContainer.style.maxWidth = val > 0 ? val + 'px' : '';
      })
    );

    this._init(filePath);
  }

  async _init(filePath) {
    let content = '';
    if (typeof this.initialContent === 'string') {
      content = this.initialContent;
      this.initialContent = null;
    } else {
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        content = '# ' + this.fileName + '\n\n';
      }
    }

    this.storedMarkdown = content;

    try {
      const kit = loadMilkdown();
      const editorContent = typeof kit.prepareMarkdownForEditor === 'function'
        ? kit.prepareMarkdownForEditor(content)
        : content;

      const editor = await kit.Editor.make()
        .config((ctx) => {
          ctx.set(kit.rootCtx, this.editorContainer);
          ctx.set(kit.defaultValueCtx, editorContent);

          ctx.get(kit.listenerCtx).updated((_ctx, doc, prevDoc) => {
            this._updateStatsFromDoc(doc);
            this._updateOutlineFromDoc(doc);
            if (!prevDoc || !doc.eq(prevDoc)) {
              if (!this._hasRecentUserChange()) return;
              if (!this.modified) {
                this.modified = true;
                this.emitter.emit('did-change-modified', true);
              }
            }
          });

          ctx.get(kit.listenerCtx).destroy(() => {
            this.milkdownEditor = null;
          });
        })
        .use(kit.commonmark)
        .use(kit.gfm)
        .use(kit.listener)
        .use(kit.history)
        .use(kit.cursor)
        .use(kit.clipboard)
        .use(kit.indent)
        .use(kit.trailing)
        .use(kit.upload)
        .use(kit.mathPlugin)
        .use(kit.codeBlockViewPlugin)
        .use(kit.sourceExpansionPlugin)
        .use(kit.taskListInteractionPlugin)
        .use(kit.imageSupportPlugin)
        .use(kit.calloutPlugin)
        .use(kit.footnotePlugin)
        .use(kit.editingKeysPlugin)
        .use(kit.slashCommandPlugin)
        .use(kit.searchReplacePlugin)
        .create();

      if (this.destroyed) {
        editor.destroy();
        return;
      }

      this.milkdownEditor = editor;
      this.initialized = true;
      this._updateStatsFromEditor();
      this._updateOutlineFromEditor();
      this._bindEditorUiEvents();
      this._updateToolbarState();
      this._restoreNavigation();
    } catch (err) {
      console.error('md-wysiwyg: Milkdown init failed', err);
        this.editorContainer.textContent = content;
      this._updateStatsFromMarkdown(content);
    }
  }

  _createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.classList.add('md-wysiwyg-toolbar');
    toolbar.setAttribute('aria-label', 'Markdown tools');

    const addButton = (label, title, command, payload = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn md-wysiwyg-toolbar-button';
      button.textContent = label;
      button.title = title;
      button.dataset.command = command;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (command === 'editLink') this.editLink();
        else if (command === 'insertImage') this.insertImage();
        else if (command === 'toggleOutline') this.toggleOutline();
        else if (command === 'find') module.exports.openSearch(false);
        else if (command === 'manageImageAssets') module.exports.showImageAssetManager();
        else this._runEditorCommand(command, payload);
      });
      toolbar.appendChild(button);
      return button;
    };

    this.toolbarButtons = {
      outline: addButton('Outline', 'Show or hide document outline', 'toggleOutline'),
      find: addButton('Find', 'Find in WYSIWYG document', 'find'),
      strong: addButton('B', 'Bold', 'strong'),
      emphasis: addButton('I', 'Italic', 'emphasis'),
      inlineCode: addButton('`', 'Inline code', 'inlineCode'),
      link: addButton('Link', 'Edit link', 'editLink'),
      bulletList: addButton('- List', 'Bullet list', 'bulletList'),
      orderedList: addButton('1. List', 'Ordered list', 'orderedList'),
      taskList: addButton('[ ] Task', 'Task list', 'taskList'),
      blockquote: addButton('Quote', 'Block quote', 'blockquote'),
      noteCallout: addButton('Note', 'Insert note callout', 'callout', { type: 'NOTE' }),
      tipCallout: addButton('Tip', 'Insert tip callout', 'callout', { type: 'TIP' }),
      warningCallout: addButton('Warn', 'Insert warning callout', 'callout', { type: 'WARNING' }),
      codeBlock: addButton('Code', 'Code block', 'codeBlock'),
      mermaid: addButton('Mermaid', 'Mermaid diagram block', 'mermaid'),
      table: addButton('Table', 'Insert table', 'table', { rows: 3, cols: 3 }),
      image: addButton('Image', 'Insert image', 'insertImage'),
      assets: addButton('Assets', 'Manage image assets', 'manageImageAssets'),
      mathInline: addButton('$x$', 'Insert inline math', 'mathInline'),
      mathBlock: addButton('$$', 'Insert math block', 'mathBlock'),
    };

    const heading = document.createElement('select');
    heading.className = 'md-wysiwyg-heading-select';
    heading.title = 'Heading';
    [
      ['paragraph', 'Text'],
      ['1', 'Heading 1'],
      ['2', 'Heading 2'],
      ['3', 'Heading 3'],
      ['4', 'Heading 4'],
      ['5', 'Heading 5'],
      ['6', 'Heading 6'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      heading.appendChild(option);
    });
    heading.addEventListener('mousedown', (event) => event.stopPropagation());
    heading.addEventListener('change', () => {
      if (heading.value === 'paragraph') this._runEditorCommand('paragraph');
      else this._runEditorCommand('heading', { level: Number(heading.value) });
      this._updateToolbarState();
    });
    this.headingSelect = heading;
    toolbar.insertBefore(heading, this.toolbarButtons.strong);

    return toolbar;
  }

  _createTableToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'md-wysiwyg-table-toolbar';
    toolbar.style.display = 'none';

    const addButton = (label, title, command, payload = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn md-wysiwyg-table-button';
      button.textContent = label;
      button.title = title;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        this._runEditorCommand(command, payload);
        this._updateToolbarState();
      });
      toolbar.appendChild(button);
      return button;
    };

    addButton('+ Row', 'Add row after', 'addTableRowAfter');
    addButton('- Row', 'Delete current row', 'deleteTableRow');
    addButton('+ Col', 'Add column after', 'addTableColumnAfter');
    addButton('- Col', 'Delete current column', 'deleteTableColumn');
    addButton('Delete Table', 'Delete current table', 'deleteTable');

    const align = document.createElement('select');
    align.className = 'md-wysiwyg-table-align';
    align.title = 'Column alignment';
    [
      ['left', 'Left'],
      ['center', 'Center'],
      ['right', 'Right'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      align.appendChild(option);
    });
    align.addEventListener('mousedown', (event) => event.stopPropagation());
    align.addEventListener('change', () => this._runEditorCommand('tableAlign', {
      alignment: align.value,
    }));
    toolbar.appendChild(align);
    this.tableAlignSelect = align;

    return toolbar;
  }

  _createOutline() {
    const outline = document.createElement('aside');
    outline.className = 'md-wysiwyg-outline';
    outline.setAttribute('aria-label', 'Document outline');

    const title = document.createElement('div');
    title.className = 'md-wysiwyg-outline-title';
    title.textContent = 'Outline';
    outline.appendChild(title);

    const hideButton = document.createElement('button');
    hideButton.type = 'button';
    hideButton.className = 'btn md-wysiwyg-outline-toggle';
    hideButton.textContent = 'Hide';
    hideButton.title = 'Hide outline';
    hideButton.addEventListener('mousedown', (event) => event.preventDefault());
    hideButton.addEventListener('click', (event) => {
      event.preventDefault();
      this.toggleOutline(true);
    });
    outline.appendChild(hideButton);
    this.outlineHideButton = hideButton;

    const list = document.createElement('div');
    list.className = 'md-wysiwyg-outline-list';
    outline.appendChild(list);
    this.outlineListElement = list;

    return outline;
  }

  _createLinkPopover() {
    const popover = document.createElement('div');
    popover.className = 'md-wysiwyg-link-popover';
    popover.style.display = 'none';

    const createField = (labelText, hintText, input) => {
      const field = document.createElement('label');
      field.className = 'md-wysiwyg-link-field';
      const label = document.createElement('span');
      label.className = 'md-wysiwyg-link-label';
      label.textContent = labelText;
      const hint = document.createElement('span');
      hint.className = 'md-wysiwyg-link-hint';
      hint.textContent = hintText;
      field.appendChild(label);
      field.appendChild(input);
      field.appendChild(hint);
      return field;
    };

    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'input-text native-key-bindings';
    text.placeholder = 'Link text';

    const href = document.createElement('input');
    href.type = 'text';
    href.className = 'input-text native-key-bindings';
    href.placeholder = 'https://example.com';

    const title = document.createElement('input');
    title.type = 'text';
    title.className = 'input-text native-key-bindings';
    title.placeholder = 'Title';

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'btn btn-primary';
    apply.textContent = 'Apply';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn';
    remove.textContent = 'Remove';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn';
    open.textContent = 'Open';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn';
    close.textContent = 'x';
    close.title = 'Close';

    [text, href, title, apply, remove, open, close].forEach((element) => {
      element.addEventListener('mousedown', (event) => event.stopPropagation());
    });

    popover.appendChild(createField('Text', 'Displayed text for a new or selected link.', text));
    popover.appendChild(createField('URL', 'Required href, for example https://example.com.', href));
    popover.appendChild(createField('Title', 'Optional Markdown link title.', title));
    popover.appendChild(apply);
    popover.appendChild(remove);
    popover.appendChild(open);
    popover.appendChild(close);

    apply.addEventListener('click', (event) => {
      event.preventDefault();
      this._runEditorCommand('setLink', {
        href: href.value,
        title: title.value,
        text: text.value,
        range: this.linkPopoverRange,
      });
      this._hideLinkPopover({ suppressAutoShow: true });
    });

    remove.addEventListener('click', (event) => {
      event.preventDefault();
      this._runEditorCommand('removeLink', { range: this.linkPopoverRange });
      this._hideLinkPopover({ suppressAutoShow: true });
    });

    open.addEventListener('click', (event) => {
      event.preventDefault();
      this._openExternalLink(href.value);
    });

    close.addEventListener('click', (event) => {
      event.preventDefault();
      this._hideLinkPopover({ suppressAutoShow: true, restoreFocus: false });
    });

    [text, href, title].forEach((input) => {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') apply.click();
        if (event.key === 'Escape') this._hideLinkPopover({
          suppressAutoShow: true,
          restoreFocus: false,
        });
      });
    });

    this.linkTextInput = text;
    this.linkHrefInput = href;
    this.linkTitleInput = title;
    this.linkRemoveButton = remove;
    this.linkOpenButton = open;

    return popover;
  }

  _bindEditorUiEvents() {
    const scheduleUpdate = () => {
      requestAnimationFrame(() => {
        this._updateToolbarState();
        this._maybeShowLinkForSelection();
        this._updateOutlineActiveItem();
      });
    };

    ['keyup', 'mouseup', 'focusin', 'click'].forEach((eventName) => {
      this.editorContainer.addEventListener(eventName, scheduleUpdate);
      this.userChangeListeners.push([eventName, scheduleUpdate, this.editorContainer]);
    });
  }

  _getEditorView() {
    if (!this.milkdownEditor || !this.initialized) return null;
    try {
      return this.milkdownEditor.action((ctx) => ctx.get(milkdownModule.editorViewCtx));
    } catch (_err) {
      return null;
    }
  }

  _getScrollElement() {
    return this.editorContainer || this.element;
  }

  _runEditorCommand(command, payload = {}) {
    const view = this._getEditorView();
    if (!view || !milkdownModule.runEditorCommand) return false;
    const handled = milkdownModule.runEditorCommand(view, command, payload);
    this._updateToolbarState();
    return handled;
  }

  _updateToolbarState() {
    const view = this._getEditorView();
    if (!view || !milkdownModule.getEditorStateInfo) return;
    const info = milkdownModule.getEditorStateInfo(view);
    const marks = info.marks || {};

    Object.keys(this.toolbarButtons || {}).forEach((name) => {
      const button = this.toolbarButtons[name];
      if (!button) return;
      button.classList.toggle('selected', Boolean(marks[name]));
    });
    if (this.toolbarButtons && this.toolbarButtons.link) {
      this.toolbarButtons.link.classList.toggle('selected', Boolean(info.link));
    }
    if (this.toolbarButtons && this.toolbarButtons.outline) {
      this.toolbarButtons.outline.classList.toggle(
        'selected',
        this.outlineItems.length > 0 && !this.outlineCollapsed
      );
    }

    if (this.headingSelect) {
      const block = info.block || {};
      if (block.name === 'heading') this.headingSelect.value = String(block.attrs.level || 1);
      else this.headingSelect.value = 'paragraph';
    }

    if (this.tableToolbarElement) {
      const table = info.table;
      this.tableToolbarElement.style.display = table ? 'flex' : 'none';
      if (table && this.tableAlignSelect) {
        const row = table.table.child(table.rowIndex);
        const cell = row && row.child(table.colIndex);
        this.tableAlignSelect.value = cell && cell.attrs.alignment
          ? cell.attrs.alignment
          : 'left';
      }
    }
  }

  _maybeShowLinkForSelection() {
    const view = this._getEditorView();
    if (!view || !milkdownModule.getLinkAtSelection) return;
    const link = milkdownModule.getLinkAtSelection(view);
    if (!link) {
      this.linkPopoverSuppression = null;
      return;
    }
    if (this._sameLinkRange(link, this.linkPopoverSuppression)) return;
    this._showLinkPopover(link, false);
  }

  editLink() {
    const view = this._getEditorView();
    if (!view) return;
    const link = milkdownModule.getLinkAtSelection
      ? milkdownModule.getLinkAtSelection(view)
      : null;
    this._showLinkPopover(link, true);
  }

  getSelectedText() {
    const view = this._getEditorView();
    if (!view) return '';
    if (milkdownModule.selectedPlainText) return milkdownModule.selectedPlainText(view);
    const { state } = view;
    return state.selection.empty
      ? ''
      : state.doc.textBetween(state.selection.from, state.selection.to, '\n', '\n');
  }

  insertText(text) {
    this._runEditorCommand('insertText', { text });
  }

  deleteSelection() {
    this._runEditorCommand('deleteSelection');
  }

  insertImage() {
    this._runEditorCommand('insertImage', { src: '', alt: '', title: '', select: true });
  }

  toggleOutline(forceCollapsed = null) {
    this.outlineCollapsed = typeof forceCollapsed === 'boolean'
      ? forceCollapsed
      : !this.outlineCollapsed;
    this._renderOutline();
    this._updateToolbarState();
  }

  _showLinkPopover(link, focusHref) {
    const view = this._getEditorView();
    if (!view || !this.linkPopover) return;
    this.linkPopoverSuppression = null;

    const selection = view.state.selection;
    const selectedRange = !selection.empty
      ? { from: selection.from, to: selection.to }
      : null;

    this.linkTextInput.value = link && link.text ? link.text : '';
    this.linkHrefInput.value = link && link.href ? link.href : '';
    this.linkTitleInput.value = link && link.title ? link.title : '';
    if (!link && selectedRange) {
      this.linkTextInput.value = view.state.doc.textBetween(selectedRange.from, selectedRange.to, '', '');
    }
    this.linkPopoverRange = link
      ? { from: link.from, to: link.to }
      : selectedRange;
    this.linkRemoveButton.disabled = !link;
    this.linkOpenButton.disabled = !(link && link.href);

    try {
      const pos = link ? link.from : view.state.selection.from;
      const coords = view.coordsAtPos(pos);
      const host = this.element.getBoundingClientRect();
      this.linkPopover.style.left = (coords.left - host.left) + 'px';
      this.linkPopover.style.top = (coords.bottom - host.top + 8) + 'px';
    } catch (_err) {
      this.linkPopover.style.left = '16px';
      this.linkPopover.style.top = '48px';
    }

    this.linkPopover.style.display = 'grid';
    if (focusHref) {
      requestAnimationFrame(() => {
        this.linkHrefInput.focus();
        this.linkHrefInput.select();
      });
    }
  }

  _sameLinkRange(a, b) {
    if (!a || !b) return false;
    return a.from === b.from && a.to === b.to;
  }

  _hideLinkPopover(options = {}) {
    const suppressAutoShow = Boolean(options.suppressAutoShow);
    const restoreFocus = options.restoreFocus !== false;
    if (suppressAutoShow && this.linkPopoverRange) {
      this.linkPopoverSuppression = { ...this.linkPopoverRange };
    }
    this.linkPopoverRange = null;
    if (this.linkPopover) this.linkPopover.style.display = 'none';
    const view = this._getEditorView();
    if (view && restoreFocus) view.focus();
  }

  _openExternalLink(href) {
    const url = String(href || '').trim();
    if (!url) return;
    try {
      require('electron').shell.openExternal(url);
    } catch (err) {
      atom.notifications.addError('Failed to open link', { detail: err.message });
    }
  }

  _observeUserChanges() {
    const events = ['beforeinput', 'input', 'paste', 'drop', 'cut', 'keydown', 'click'];
    const noteUserChange = () => {
      this.userChangePendingUntil = Date.now() + 2000;
    };

    events.forEach((eventName) => {
      this.element.addEventListener(eventName, noteUserChange, true);
      this.userChangeListeners.push([eventName, noteUserChange, this.element]);
    });
  }

  _hasRecentUserChange() {
    return Date.now() <= this.userChangePendingUntil;
  }

  _updateStatsFromDoc(doc) {
    if (!doc) return;
    this.stats = statsForText(doc.textBetween(0, doc.content.size, '\n\n', '\n'));
    this._renderInlineStats();
    this.emitter.emit('did-update-stats', this.stats);
  }

  _updateStatsFromMarkdown(markdown) {
    this.stats = statsForText(markdown);
    this._renderInlineStats();
    this.emitter.emit('did-update-stats', this.stats);
  }

  _renderInlineStats() {
    if (!this.statsElement) return;
    this.statsElement.textContent = formatStats(this.stats);
  }

  _updateStatsFromEditor() {
    if (!this.milkdownEditor || !this.initialized) {
      this._updateStatsFromMarkdown(this.storedMarkdown);
      return;
    }
    try {
      this.milkdownEditor.action((ctx) => {
        const view = ctx.get(milkdownModule.editorViewCtx);
        this._updateStatsFromDoc(view.state.doc);
      });
    } catch (_err) {
      this._updateStatsFromMarkdown(this.storedMarkdown);
    }
  }

  _updateOutlineFromEditor() {
    if (!this.milkdownEditor || !this.initialized) {
      this._updateOutlineFromDoc(null);
      return;
    }
    try {
      this.milkdownEditor.action((ctx) => {
        const view = ctx.get(milkdownModule.editorViewCtx);
        this._updateOutlineFromDoc(view.state.doc);
      });
    } catch (_err) {
      this._updateOutlineFromDoc(null);
    }
  }

  _updateOutlineFromDoc(doc) {
    this.outlineItems = collectHeadings(doc);
    this._renderOutline();
    this._updateOutlineActiveItem();
  }

  _renderOutline() {
    if (!this.outlineListElement || !this.outlineElement) return;
    const shouldShow = this.outlineItems.length > 0 && !this.outlineCollapsed;
    this.outlineListElement.textContent = '';
    this.outlineElement.style.display = shouldShow ? '' : 'none';
    if (this.mainElement) {
      this.mainElement.classList.toggle('no-outline', !shouldShow);
    }

    if (!shouldShow) return;

    this.outlineItems.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'md-wysiwyg-outline-item';
      button.dataset.index = String(index);
      button.dataset.level = String(item.level);
      button.title = item.text;
      button.textContent = item.text;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        this._jumpToOutlineItem(index);
      });
      this.outlineListElement.appendChild(button);
    });
  }

  _jumpToOutlineItem(index) {
    const item = this.outlineItems[index];
    const view = this._getEditorView();
    if (!item || !view || !milkdownModule.TextSelection) return;
    try {
      const pos = clamp(item.pos + 1, 1, Math.max(view.state.doc.content.size - 1, 1));
      const selection = milkdownModule.TextSelection.near(view.state.doc.resolve(pos));
      view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
      view.focus();
      this._updateOutlineActiveItem();
    } catch (err) {
      console.warn('md-wysiwyg: failed to jump to outline heading', err);
    }
  }

  _updateOutlineActiveItem() {
    if (!this.outlineListElement || !this.outlineItems.length) return;
    const view = this._getEditorView();
    const selectionPos = view ? view.state.selection.from : 0;
    let activeIndex = -1;
    this.outlineItems.forEach((item, index) => {
      if (item.pos <= selectionPos) activeIndex = index;
    });

    Array.from(this.outlineListElement.children).forEach((child, index) => {
      child.classList.toggle('selected', index === activeIndex);
    });
  }

  _restoreNavigation() {
    const restore = this.restoreNavigation;
    if (!restore || !this.milkdownEditor || !this.initialized) return;
    this.restoreNavigation = null;

    try {
      this.milkdownEditor.action((ctx) => {
        const view = ctx.get(milkdownModule.editorViewCtx);
        const doc = view.state.doc;
        const anchorPos = findTextBlockPosition(doc, restore.anchorText);
        const ratioPos = restore.sourceLength > 0
          ? Math.floor((restore.sourceOffset / restore.sourceLength) * doc.content.size)
          : 1;
        const pos = clamp(anchorPos != null ? anchorPos : ratioPos, 1, Math.max(doc.content.size - 1, 1));
        const selection = milkdownModule.TextSelection.near(doc.resolve(pos));
        view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
      });
    } catch (err) {
      console.warn('md-wysiwyg: failed to restore editor position', err);
    }

    requestAnimationFrame(() => restoreElementScroll(this._getScrollElement(), restore.scrollRatio));
  }

  getNavigationSnapshot() {
    const snapshot = {
      anchorText: '',
      scrollRatio: scrollRatioForElement(this._getScrollElement()),
    };

    if (!this.milkdownEditor || !this.initialized) return snapshot;

    try {
      return this.milkdownEditor.action((ctx) => {
        const view = ctx.get(milkdownModule.editorViewCtx);
        const selection = view.state.selection;
        const parent = selection.$from.parent;
        return {
          anchorText: parent && parent.isTextblock ? parent.textContent : '',
          plainPrefixLength: view.state.doc.textBetween(0, selection.from, '\n', '\n').length,
          scrollRatio: scrollRatioForElement(this._getScrollElement()),
        };
      });
    } catch (_err) {
      return snapshot;
    }
  }

  getMarkdownContent() {
    if (this.milkdownEditor && this.initialized) {
      try {
        const markdown = this.milkdownEditor.action((ctx) => {
          const view = ctx.get(milkdownModule.editorViewCtx);
          const serializer = ctx.get(milkdownModule.serializerCtx);
          const doc = typeof milkdownModule.getDocWithCollapsedSource === 'function'
            ? milkdownModule.getDocWithCollapsedSource(view)
            : view.state.doc;
          return serializer(doc);
        });
        const restored = typeof milkdownModule.restoreMarkdownFromEditor === 'function'
          ? milkdownModule.restoreMarkdownFromEditor(markdown)
          : markdown;
        this.storedMarkdown = restored;
        return restored;
      } catch (e) {
        return this.storedMarkdown;
      }
    }
    return this.storedMarkdown;
  }

  getTitle() { return this.fileName; }
  getLongTitle() { return this.fileName + (this.modified ? ' (modified)' : ''); }
  getURI() { return PROTOCOL + this.filePath; }
  getPath() { return this.filePath; }
  getElement() { return this.element; }
  serialize() {
    return { filePath: this.filePath, deserializer: 'MdWysiwygEditor' };
  }
  isModified() { return this.modified; }
  onDidChangeModified(cb) { return this.emitter.on('did-change-modified', cb); }
  onDidChangeTitle(cb) { return this.emitter.on('did-change-title', cb); }
  onDidDestroy(cb) { return this.emitter.on('did-destroy', cb); }
  onDidUpdateStats(cb) { return this.emitter.on('did-update-stats', cb); }
  getStats() { return this.stats; }
  copy() {
    return new MdWysiwygEditor(this.filePath, {
      content: this.getMarkdownContent(),
      modified: this.modified,
    });
  }

  async save(filePath) {
    const targetPath = filePath || this.filePath;
    const markdown = this.getMarkdownContent();
    try {
      await fs.promises.writeFile(targetPath, markdown, 'utf8');
    } catch (err) {
      atom.notifications.addError('Failed to save', { detail: err.message });
      return;
    }
    if (filePath && filePath !== this.filePath) {
      this.filePath = filePath;
      this.fileName = path.basename(filePath);
      this.element.setAttribute('data-file-path', filePath);
      this.emitter.emit('did-change-title', this.fileName);
    }
    this.modified = false;
    this.emitter.emit('did-change-modified', false);
    this._updateStatsFromMarkdown(markdown);
  }

  shouldPromptToSave() { return this.modified; }

  destroy() {
    this.destroyed = true;
    this.emitter.emit('did-destroy');
    this.emitter.dispose();
    this.disposables.dispose();
    this.userChangeListeners.forEach(([eventName, listener, target]) => {
      const element = target || this.element;
      element.removeEventListener(eventName, listener, element === this.element);
    });
    this.userChangeListeners = [];
    if (this.statsElement) {
      this.statsElement.remove();
      this.statsElement = null;
    }
    if (this.milkdownEditor) {
      this.milkdownEditor.destroy();
      this.milkdownEditor = null;
    }
    this.element.remove();
  }
}

module.exports = {
  subscriptions: null,
  statusBarTile: null,
  statusBarElement: null,
  activeStatsSubscription: null,
  activeItem: null,
  sourceModePaths: null,

  activate(state) {
    this.subscriptions = new CompositeDisposable();
    this.sourceModePaths = new Set();

    this.subscriptions.add(
      atom.workspace.addOpener((uri) => {
        if (uri.startsWith(PROTOCOL)) {
          const filePath = uri.replace(PROTOCOL, '');
          return new MdWysiwygEditor(filePath);
        }
        const filePath = filePathFromUri(uri);
        if (
          filePath &&
          isMarkdownPath(filePath) &&
          atom.config.get('md-wysiwyg.openMarkdownAsWysiwyg') !== false &&
          !this.sourceModePaths.has(filePath)
        ) {
          return new MdWysiwygEditor(filePath);
        }
      })
    );

    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'md-wysiwyg:toggle': () => this.toggle(),
      'md-wysiwyg:edit-link': () => this.editLink(),
      'md-wysiwyg:copy': () => this.copySelection(),
      'md-wysiwyg:cut': () => this.cutSelection(),
      'md-wysiwyg:paste': () => this.pasteClipboard(),
      'md-wysiwyg:manage-image-assets': () => this.showImageAssetManager(),
      'md-wysiwyg:find': () => this.openSearch(false),
      'md-wysiwyg:replace': () => this.openSearch(true),
    }));

    this.subscriptions.add(
      atom.workspace.observeActivePaneItem((item) => this._observeActiveItem(item))
    );

    this.subscriptions.add(
      atom.workspace.observeTextEditors((editor) => this._maybeOpenTextEditorAsWysiwyg(editor))
    );

    if (state && state.openUris) {
      state.openUris.forEach((uri) => {
        atom.workspace.open(uri, { activateItem: false });
      });
    }

    this._initThemeAdapter();
  },

  _maybeOpenTextEditorAsWysiwyg(editor) {
    if (!editor || !editor.getPath) return;
    if (atom.config.get('md-wysiwyg.openMarkdownAsWysiwyg') === false) return;

    const filePath = editor.getPath();
    if (!isMarkdownPath(filePath)) return;

    if (this.sourceModePaths && this.sourceModePaths.has(filePath)) {
      const disposable = editor.onDidDestroy && editor.onDidDestroy(() => {
        this.sourceModePaths.delete(filePath);
        if (disposable) disposable.dispose();
      });
      return;
    }

    requestAnimationFrame(() => {
      if (!editor || (editor.isDestroyed && editor.isDestroyed())) return;
      const pane = atom.workspace.paneForItem(editor);
      if (!pane) return;
      if (pane.getItems && !pane.getItems().includes(editor)) return;
      this._switchToWysiwyg(editor, pane);
    });
  },

  consumeStatusBar(statusBar) {
    this.statusBarElement = document.createElement('div');
    this.statusBarElement.classList.add('md-wysiwyg-status');
    this.statusBarElement.title = 'Markdown word count, characters, and estimated reading time';
    this.statusBarElement.style.display = 'none';

    this.statusBarTile = statusBar.addRightTile({
      item: this.statusBarElement,
      priority: 100,
    });

    this._updateStatusBar();

    return new CompositeDisposable({
      dispose: () => {
        if (this.statusBarTile) this.statusBarTile.destroy();
        this.statusBarTile = null;
        this.statusBarElement = null;
      },
    });
  },

  _observeActiveItem(item) {
    if (this.activeStatsSubscription) {
      this.activeStatsSubscription.dispose();
      this.activeStatsSubscription = null;
    }

    this.activeItem = item;

    if (item instanceof MdWysiwygEditor) {
      this.activeStatsSubscription = new CompositeDisposable(
        item.onDidUpdateStats(() => this._updateStatusBar()),
        item.onDidDestroy(() => {
          if (this.activeItem === item) this._observeActiveItem(null);
        })
      );
      item._updateStatsFromEditor();
    }

    this._updateStatusBar();
  },

  _updateStatusBar() {
    if (!this.statusBarElement) return;

    if (this.activeItem instanceof MdWysiwygEditor) {
      const text = formatStats(this.activeItem.getStats());
      this.statusBarElement.textContent = text;
      this.statusBarElement.style.display = text ? '' : 'none';
    } else {
      this.statusBarElement.textContent = '';
      this.statusBarElement.style.display = 'none';
    }
  },

  toggle() {
    const pane = atom.workspace.getActivePane();
    const active = pane.getActiveItem();

    if (active instanceof MdWysiwygEditor) {
      this._switchToSource(active);
    } else {
      const editor = active && active.getText && active.getPath
        ? active
        : atom.workspace.getActiveTextEditor();
      if (!editor) return;
      const filePath = editor.getPath();
      if (!isMarkdownPath(filePath)) return;
      this._switchToWysiwyg(editor, pane);
    }
  },

  editLink() {
    const active = atom.workspace.getActivePaneItem();
    if (active instanceof MdWysiwygEditor) active.editLink();
  },

  openSearch(replaceMode = false) {
    const active = atom.workspace.getActivePaneItem();
    if (!(active instanceof MdWysiwygEditor)) return;
    const view = active._getEditorView();
    if (view && milkdownModule.openSearchPanel) milkdownModule.openSearchPanel(view, replaceMode);
  },

  copySelection() {
    const active = atom.workspace.getActivePaneItem();
    if (!(active instanceof MdWysiwygEditor)) return;
    const text = active.getSelectedText();
    if (text) atom.clipboard.write(text);
  },

  cutSelection() {
    const active = atom.workspace.getActivePaneItem();
    if (!(active instanceof MdWysiwygEditor)) return;
    const text = active.getSelectedText();
    if (!text) return;
    atom.clipboard.write(text);
    active.deleteSelection();
  },

  pasteClipboard() {
    const active = atom.workspace.getActivePaneItem();
    if (!(active instanceof MdWysiwygEditor)) return;
    const text = atom.clipboard.read();
    if (text) active.insertText(text);
  },

  async showImageAssetManager() {
    const root = document.createElement('div');
    root.className = 'md-wysiwyg-asset-manager';
    root.innerHTML = '<div class="md-wysiwyg-asset-loading">Loading image assets...</div>';

    const panel = atom.workspace.addModalPanel({ item: root, visible: true });
    const close = () => panel.destroy();

    try {
      const index = await imageAssets.buildAssetIndex();
      this._renderImageAssetManager(root, index, close);
    } catch (err) {
      root.innerHTML = '';
      const message = document.createElement('div');
      message.className = 'md-wysiwyg-asset-error';
      message.textContent = 'Failed to load image assets: ' + err.message;
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'btn';
      closeButton.textContent = 'Close';
      closeButton.addEventListener('click', close);
      root.appendChild(message);
      root.appendChild(closeButton);
    }
  },

  _renderImageAssetManager(root, index, close) {
    const refresh = async () => {
      root.innerHTML = '<div class="md-wysiwyg-asset-loading">Refreshing...</div>';
      this._renderImageAssetManager(root, await imageAssets.buildAssetIndex(), close);
    };

    root.innerHTML = '';
    const header = document.createElement('header');
    header.className = 'md-wysiwyg-asset-header';
    const title = document.createElement('div');
    const titleText = document.createElement('strong');
    titleText.textContent = 'Image Assets';
    const titlePath = document.createElement('span');
    titlePath.textContent = index.assetsDir;
    title.appendChild(titleText);
    title.appendChild(titlePath);
    const actions = document.createElement('div');
    actions.className = 'md-wysiwyg-asset-actions';

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'btn';
    refreshButton.textContent = 'Refresh';
    refreshButton.addEventListener('click', refresh);

    const cleanButton = document.createElement('button');
    cleanButton.type = 'button';
    cleanButton.className = 'btn';
    cleanButton.textContent = 'Clean Unused';
    cleanButton.addEventListener('click', async () => {
      const unused = index.assets.filter((asset) => asset.references.length === 0);
      if (unused.length === 0) {
        atom.notifications.addInfo('No unused image assets found');
        return;
      }
      const choice = atom.confirm({
        message: 'Delete ' + unused.length + ' unused image asset' + (unused.length === 1 ? '?' : 's?'),
        detailedMessage: unused.map((asset) => asset.name).join('\n'),
        buttons: ['Delete', 'Cancel'],
      });
      if (choice !== 0) return;
      try {
        await imageAssets.deleteAssets(unused.map((asset) => asset.filePath));
        atom.notifications.addSuccess('Unused image assets deleted');
        await refresh();
      } catch (err) {
        atom.notifications.addError('Failed to delete image assets', { detail: err.message });
      }
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', close);

    actions.appendChild(refreshButton);
    actions.appendChild(cleanButton);
    actions.appendChild(closeButton);
    header.appendChild(title);
    header.appendChild(actions);
    root.appendChild(header);

    const list = document.createElement('div');
    list.className = 'md-wysiwyg-asset-list';
    if (index.assets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'md-wysiwyg-asset-empty';
      empty.textContent = 'No image assets found.';
      list.appendChild(empty);
    }

    index.assets.forEach((asset) => {
      const row = document.createElement('article');
      row.className = 'md-wysiwyg-asset-row';
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'md-wysiwyg-asset-preview';
      const image = document.createElement('img');
      image.src = pathToFileURL(asset.filePath).href;
      image.alt = asset.name;
      preview.appendChild(image);
      preview.addEventListener('click', () => this._showImagePreview(asset));

      const detail = document.createElement('div');
      detail.className = 'md-wysiwyg-asset-detail';
      const name = document.createElement('strong');
      name.textContent = asset.name;
      const meta = document.createElement('span');
      meta.textContent = this._formatAssetSize(asset.size) + ' · ' +
        asset.references.length + ' reference' + (asset.references.length === 1 ? '' : 's');
      detail.appendChild(name);
      detail.appendChild(meta);

      const refs = document.createElement('div');
      refs.className = 'md-wysiwyg-asset-refs';
      if (asset.references.length === 0) {
        refs.textContent = 'Unused';
      } else {
        asset.references.slice(0, 4).forEach((ref) => {
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'btn btn-xs';
          link.textContent = path.basename(ref.docPath);
          link.title = ref.docPath;
          link.addEventListener('click', () => atom.workspace.open(ref.docPath));
          refs.appendChild(link);
        });
        if (asset.references.length > 4) {
          const more = document.createElement('span');
          more.textContent = '+' + (asset.references.length - 4) + ' more';
          refs.appendChild(more);
        }
      }
      detail.appendChild(refs);

      const rowActions = document.createElement('div');
      rowActions.className = 'md-wysiwyg-asset-row-actions';
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'btn btn-xs';
      copyButton.textContent = 'Copy';
      copyButton.addEventListener('click', () => {
        const active = atom.workspace.getActivePaneItem();
        const docPath = active && active.getPath ? active.getPath() : null;
        const src = imageAssets.pathToMarkdownSrc(asset.filePath, docPath || asset.filePath);
        atom.clipboard.write('![](' + src + ')');
      });

      const renameButton = document.createElement('button');
      renameButton.type = 'button';
      renameButton.className = 'btn btn-xs';
      renameButton.textContent = 'Rename';
      renameButton.addEventListener('click', async () => {
        const nextName = window.prompt('New image file name', asset.name);
        if (!nextName || nextName === asset.name) return;
        try {
          await imageAssets.renameAsset(asset.filePath, nextName, index.references);
          atom.notifications.addSuccess('Image asset renamed and references updated');
          await refresh();
        } catch (err) {
          atom.notifications.addError('Failed to rename image asset', { detail: err.message });
        }
      });

      rowActions.appendChild(copyButton);
      rowActions.appendChild(renameButton);
      row.appendChild(preview);
      row.appendChild(detail);
      row.appendChild(rowActions);
      list.appendChild(row);
    });

    root.appendChild(list);
  },

  _showImagePreview(asset) {
    const root = document.createElement('div');
    root.className = 'md-wysiwyg-image-preview-modal';
    const image = document.createElement('img');
    image.src = pathToFileURL(asset.filePath).href;
    image.alt = asset.name;
    const caption = document.createElement('div');
    caption.textContent = asset.filePath;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn';
    closeButton.textContent = 'Close';
    root.appendChild(image);
    root.appendChild(caption);
    root.appendChild(closeButton);
    const panel = atom.workspace.addModalPanel({ item: root, visible: true });
    closeButton.addEventListener('click', () => panel.destroy());
  },

  _formatAssetSize(size) {
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return Math.round(size / 1024) + ' KB';
    return (size / 1024 / 1024).toFixed(1) + ' MB';
  },

  _switchToWysiwyg(textEditor, pane) {
    const filePath = textEditor.getPath();
    if (this.sourceModePaths) this.sourceModePaths.delete(filePath);
    const content = textEditor.getText();
    const cursor = textEditor.getCursorBufferPosition
      ? textEditor.getCursorBufferPosition()
      : { row: 0, column: 0 };
    const row = typeof cursor.row === 'number' ? cursor.row : 0;
    const column = typeof cursor.column === 'number' ? cursor.column : 0;
    const lines = content.split('\n');
    const scrollInfo = getTextEditorScrollInfo(textEditor);
    const wysiwygEditor = new MdWysiwygEditor(filePath, {
      content,
      modified: textEditor.isModified && textEditor.isModified(),
      restoreNavigation: {
        anchorText: lines[row] || '',
        sourceOffset: textOffsetForPosition(content, row, column),
        sourceLength: content.length,
        scrollRatio: scrollInfo.maxScroll > 0 ? scrollInfo.scrollTop / scrollInfo.maxScroll : 0,
      },
    });
    pane.activateItem(wysiwygEditor);
    pane.destroyItem(textEditor);
  },

  async _switchToSource(wysiwygEditor) {
    const pane = atom.workspace.paneForItem(wysiwygEditor) || atom.workspace.getActivePane();
    const shouldWriteMarkdown = wysiwygEditor.isModified();
    const navigation = wysiwygEditor.getNavigationSnapshot();
    const markdown = shouldWriteMarkdown ? wysiwygEditor.getMarkdownContent() : null;
    const filePath = wysiwygEditor.getPath();

    try {
      if (this.sourceModePaths) this.sourceModePaths.add(filePath);
      const textEditor = await atom.workspace.open(filePath, { activateItem: true });
      const sourceText = shouldWriteMarkdown ? markdown : textEditor.getText();
      if (shouldWriteMarkdown && textEditor && textEditor.setText) {
        if (textEditor.getText() !== markdown) textEditor.setText(markdown);
      }
      this._restoreSourceNavigation(textEditor, sourceText, navigation);
      pane.destroyItem(wysiwygEditor);
    } catch (err) {
      if (this.sourceModePaths) this.sourceModePaths.delete(filePath);
      atom.notifications.addError('Failed to switch to Markdown source', {
        detail: err.message,
      });
    }
  },

  _restoreSourceNavigation(textEditor, markdown, navigation) {
    if (!textEditor || !markdown || !navigation) return;

    const anchorPosition = findSourcePositionForAnchor(markdown, navigation.anchorText);
    const offsetPosition = typeof navigation.plainPrefixLength === 'number'
      ? positionForTextOffset(markdown, navigation.plainPrefixLength)
      : null;
    const position = anchorPosition || offsetPosition;

    if (position && textEditor.setCursorBufferPosition) {
      textEditor.setCursorBufferPosition(position, { autoscroll: false });
    }

    if (position && textEditor.scrollToBufferPosition) {
      textEditor.scrollToBufferPosition(position, { center: true });
    } else if (typeof navigation.scrollRatio === 'number') {
      const scrollInfo = getTextEditorScrollInfo(textEditor);
      setTextEditorScrollTop(
        textEditor,
        scrollInfo.maxScroll * clamp(navigation.scrollRatio, 0, 1)
      );
    }
  },

  _initThemeAdapter() {
    const updateTheme = () => {
      const isDark = this._isDarkTheme();
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      window.dispatchEvent(new CustomEvent('md-wysiwyg:theme-changed', {
        detail: { theme: isDark ? 'dark' : 'light' },
      }));
    };
    updateTheme();
    this.subscriptions.add(
      atom.config.observe('core.themes', updateTheme)
    );
  },

  _isDarkTheme() {
    const themes = atom.config.get('core.themes') || [];
    const uiTheme = Array.isArray(themes) ? themes[0] : themes;
    if (typeof uiTheme === 'string') {
      const name = uiTheme.toLowerCase();
      if (name.includes('light')) return false;
      return name.includes('dark') || name.includes('night') ||
             name.includes('monokai') || name.includes('one-dark');
    }
    return true;
  },

  deactivate() {
    if (this.activeStatsSubscription) {
      this.activeStatsSubscription.dispose();
      this.activeStatsSubscription = null;
    }
    if (this.statusBarTile) {
      this.statusBarTile.destroy();
      this.statusBarTile = null;
    }
    this.subscriptions.dispose();
  },

  serialize() {
    const openUris = [];
    atom.workspace.getPaneItems().forEach((item) => {
      if (item instanceof MdWysiwygEditor) {
        openUris.push(item.getURI());
      }
    });
    return { openUris };
  }
};
