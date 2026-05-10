'use babel';

const { CompositeDisposable } = require('atom');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const PROTOCOL = 'md-wysiwyg://';

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
    this.userChangePendingUntil = 0;
    this.userChangeListeners = [];

    this.element = document.createElement('div');
    this.element.classList.add('md-wysiwyg-editor');
    this._observeUserChanges();

    this.editorContainer = document.createElement('div');
    this.editorContainer.classList.add('milkdown-container');
    this.element.appendChild(this.editorContainer);

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
        .create();

      if (this.destroyed) {
        editor.destroy();
        return;
      }

      this.milkdownEditor = editor;
      this.initialized = true;
    } catch (err) {
      console.error('md-wysiwyg: Milkdown init failed', err);
      this.editorContainer.textContent = content;
    }
  }

  _observeUserChanges() {
    const events = ['beforeinput', 'input', 'paste', 'drop', 'cut', 'keydown', 'click'];
    const noteUserChange = () => {
      this.userChangePendingUntil = Date.now() + 2000;
    };

    events.forEach((eventName) => {
      this.element.addEventListener(eventName, noteUserChange, true);
      this.userChangeListeners.push([eventName, noteUserChange]);
    });
  }

  _hasRecentUserChange() {
    return Date.now() <= this.userChangePendingUntil;
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
  copy() { return new MdWysiwygEditor(this.filePath); }

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
  }

  shouldPromptToSave() { return this.modified; }

  destroy() {
    this.destroyed = true;
    this.emitter.emit('did-destroy');
    this.emitter.dispose();
    this.disposables.dispose();
    this.userChangeListeners.forEach(([eventName, listener]) => {
      this.element.removeEventListener(eventName, listener, true);
    });
    this.userChangeListeners = [];
    if (this.milkdownEditor) {
      this.milkdownEditor.destroy();
      this.milkdownEditor = null;
    }
    this.element.remove();
  }
}

module.exports = {
  subscriptions: null,

  activate(state) {
    this.subscriptions = new CompositeDisposable();

    this.subscriptions.add(
      atom.workspace.addOpener((uri) => {
        if (uri.startsWith(PROTOCOL)) {
          const filePath = uri.replace(PROTOCOL, '');
          return new MdWysiwygEditor(filePath);
        }
      })
    );

    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'md-wysiwyg:toggle': () => this.toggle(),
    }));

    if (state && state.openUris) {
      state.openUris.forEach((uri) => {
        atom.workspace.open(uri, { activateItem: false });
      });
    }

    this._initThemeAdapter();
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
      if (!filePath || !filePath.endsWith('.md')) return;
      this._switchToWysiwyg(editor, pane);
    }
  },

  _switchToWysiwyg(textEditor, pane) {
    const filePath = textEditor.getPath();
    const wysiwygEditor = new MdWysiwygEditor(filePath, {
      content: textEditor.getText(),
      modified: textEditor.isModified && textEditor.isModified(),
    });
    pane.activateItem(wysiwygEditor);
    pane.destroyItem(textEditor);
  },

  async _switchToSource(wysiwygEditor) {
    const pane = atom.workspace.paneForItem(wysiwygEditor) || atom.workspace.getActivePane();
    const shouldWriteMarkdown = wysiwygEditor.isModified();
    const markdown = shouldWriteMarkdown ? wysiwygEditor.getMarkdownContent() : null;
    const filePath = wysiwygEditor.getPath();

    try {
      const textEditor = await atom.workspace.open(filePath, { activateItem: true });
      if (shouldWriteMarkdown && textEditor && textEditor.setText) {
        if (textEditor.getText() !== markdown) textEditor.setText(markdown);
      }
      pane.destroyItem(wysiwygEditor);
    } catch (err) {
      atom.notifications.addError('Failed to switch to Markdown source', {
        detail: err.message,
      });
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
