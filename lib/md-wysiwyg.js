'use babel';

const { CompositeDisposable } = require('atom');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');

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

    this.element = document.createElement('div');
    this.element.classList.add('md-wysiwyg-editor');
    this._observeUserChanges();

    this.toolbarElement = this._createToolbar();
    this.element.appendChild(this.toolbarElement);

    this.tableToolbarElement = this._createTableToolbar();
    this.element.appendChild(this.tableToolbarElement);

    this.editorContainer = document.createElement('div');
    this.editorContainer.classList.add('milkdown-container');
    this.element.appendChild(this.editorContainer);

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

      const editor = await kit.Editor.make()
        .config((ctx) => {
          ctx.set(kit.rootCtx, this.editorContainer);
          ctx.set(kit.defaultValueCtx, content);

          ctx.get(kit.listenerCtx).updated((_ctx, doc, prevDoc) => {
            this._updateStatsFromDoc(doc);
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
        .use(kit.editingKeysPlugin)
        .use(kit.slashCommandPlugin)
        .create();

      if (this.destroyed) {
        editor.destroy();
        return;
      }

      this.milkdownEditor = editor;
      this.initialized = true;
      this._updateStatsFromEditor();
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
        else this._runEditorCommand(command, payload);
      });
      toolbar.appendChild(button);
      return button;
    };

    this.toolbarButtons = {
      strong: addButton('B', 'Bold', 'strong'),
      emphasis: addButton('I', 'Italic', 'emphasis'),
      inlineCode: addButton('`', 'Inline code', 'inlineCode'),
      link: addButton('Link', 'Edit link', 'editLink'),
      bulletList: addButton('- List', 'Bullet list', 'bulletList'),
      orderedList: addButton('1. List', 'Ordered list', 'orderedList'),
      taskList: addButton('[ ] Task', 'Task list', 'taskList'),
      blockquote: addButton('Quote', 'Block quote', 'blockquote'),
      codeBlock: addButton('Code', 'Code block', 'codeBlock'),
      mermaid: addButton('Mermaid', 'Mermaid diagram block', 'mermaid'),
      table: addButton('Table', 'Insert table', 'table', { rows: 3, cols: 3 }),
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
      this.linkPopover.style.top = (coords.bottom - host.top + 8 + this.element.scrollTop) + 'px';
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

    requestAnimationFrame(() => restoreElementScroll(this.element, restore.scrollRatio));
  }

  getNavigationSnapshot() {
    const snapshot = {
      anchorText: '',
      scrollRatio: scrollRatioForElement(this.element),
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
          scrollRatio: scrollRatioForElement(this.element),
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
        this.storedMarkdown = markdown;
        return markdown;
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
    const scrollTop = textEditor.getScrollTop ? textEditor.getScrollTop() : 0;
    const scrollHeight = textEditor.getScrollHeight ? textEditor.getScrollHeight() : 0;
    const height = textEditor.getHeight ? textEditor.getHeight() : 0;
    const maxScroll = scrollHeight > height ? scrollHeight - height : 0;
    const wysiwygEditor = new MdWysiwygEditor(filePath, {
      content,
      modified: textEditor.isModified && textEditor.isModified(),
      restoreNavigation: {
        anchorText: lines[row] || '',
        sourceOffset: textOffsetForPosition(content, row, column),
        sourceLength: content.length,
        scrollRatio: maxScroll > 0 ? scrollTop / maxScroll : 0,
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
    } else if (textEditor.setScrollTop && typeof navigation.scrollRatio === 'number') {
      const scrollHeight = textEditor.getScrollHeight ? textEditor.getScrollHeight() : 0;
      const height = textEditor.getHeight ? textEditor.getHeight() : 0;
      const maxScroll = scrollHeight > height ? scrollHeight - height : 0;
      textEditor.setScrollTop(maxScroll * clamp(navigation.scrollRatio, 0, 1));
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
