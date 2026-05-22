import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export const searchReplaceKey = new PluginKey('md-wysiwyg-search-replace');

const SKIP_BLOCKS = new Set(['code_block', 'math_block', 'frontmatter']);

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shouldSkipText(parent) {
  return parent && SKIP_BLOCKS.has(parent.type.name);
}

function matchText(text, query, options) {
  if (!query) return [];
  const flags = options.matchCase ? 'g' : 'gi';
  const source = options.wholeWord ? '\\b' + escapeRegExp(query) + '\\b' : escapeRegExp(query);
  const regexp = new RegExp(source, flags);
  const matches = [];
  let match;
  while ((match = regexp.exec(text))) {
    matches.push({ from: match.index, to: match.index + match[0].length });
    if (match[0].length === 0) regexp.lastIndex++;
  }
  return matches;
}

function collectMatches(doc, query, options) {
  const matches = [];
  if (!query) return matches;
  doc.descendants((node, pos, parent) => {
    if (SKIP_BLOCKS.has(node.type.name)) return false;
    if (!node.isText || shouldSkipText(parent)) return true;
    matchText(node.text || '', query, options).forEach((match) => {
      matches.push({ from: pos + match.from, to: pos + match.to });
    });
    return true;
  });
  return matches;
}

function createState(doc, attrs = {}) {
  const state = {
    show: Boolean(attrs.show),
    replaceMode: Boolean(attrs.replaceMode),
    query: attrs.query || '',
    replace: attrs.replace || '',
    matchCase: Boolean(attrs.matchCase),
    wholeWord: Boolean(attrs.wholeWord),
    activeIndex: attrs.activeIndex || 0,
    matches: [],
  };
  state.matches = collectMatches(doc, state.query, state);
  if (state.activeIndex >= state.matches.length) state.activeIndex = Math.max(state.matches.length - 1, 0);
  return state;
}

function buildDecorations(doc, pluginState) {
  if (!pluginState || !pluginState.query) return DecorationSet.empty;
  const decorations = pluginState.matches.map((match, index) => {
    const className = index === pluginState.activeIndex
      ? 'md-wysiwyg-search-hit active'
      : 'md-wysiwyg-search-hit';
    return Decoration.inline(match.from, match.to, { class: className });
  });
  return DecorationSet.create(doc, decorations);
}

function nextIndex(state, delta) {
  if (!state.matches.length) return 0;
  return (state.activeIndex + delta + state.matches.length) % state.matches.length;
}

function openSearch(view, replaceMode = false) {
  view.dispatch(view.state.tr.setMeta(searchReplaceKey, { type: 'open', replaceMode }));
  view.focus();
}

function closeSearch(view) {
  view.dispatch(view.state.tr.setMeta(searchReplaceKey, { type: 'close' }));
  view.focus();
}

function replaceCurrent(view, pluginState) {
  const match = pluginState.matches[pluginState.activeIndex];
  if (!match) return false;
  view.dispatch(view.state.tr.insertText(pluginState.replace, match.from, match.to).scrollIntoView());
  return true;
}

function replaceAll(view, pluginState) {
  if (!pluginState.matches.length) return false;
  let tr = view.state.tr;
  pluginState.matches.slice().reverse().forEach((match) => {
    tr = tr.insertText(pluginState.replace, match.from, match.to);
  });
  view.dispatch(tr.scrollIntoView());
  return true;
}

function scrollCoordsIntoContainer(view, pos) {
  const container = view.dom.closest('.milkdown-container') ||
    view.dom.closest('.md-wysiwyg-editor') ||
    view.dom.parentElement;
  if (!container) return;

  try {
    const coords = view.coordsAtPos(pos);
    const containerRect = container.getBoundingClientRect();
    const padding = 56;
    if (coords.top < containerRect.top + padding) {
      container.scrollTop -= (containerRect.top + padding) - coords.top;
    } else if (coords.bottom > containerRect.bottom - padding) {
      container.scrollTop += coords.bottom - (containerRect.bottom - padding);
    }
  } catch (_err) {
    // Fallback for edge positions where coordsAtPos cannot resolve cleanly.
    const dom = view.domAtPos(pos).node;
    const element = dom && dom.nodeType === Node.TEXT_NODE ? dom.parentElement : dom;
    if (element && element.scrollIntoView) {
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }
}

function revealActiveMatch(view) {
  const pluginState = searchReplaceKey.getState(view.state);
  const match = pluginState && pluginState.matches[pluginState.activeIndex];
  if (!match) return false;
  const selection = TextSelection.create(view.state.doc, match.from, match.to);
  const tr = view.state.selection.eq(selection)
    ? view.state.tr.scrollIntoView()
    : view.state.tr.setSelection(selection).scrollIntoView();
  view.dispatch(tr);
  requestAnimationFrame(() => scrollCoordsIntoContainer(view, match.from));
  return true;
}

class SearchReplaceView {
  constructor(view) {
    this.view = view;
    this.root = document.createElement('div');
    this.root.className = 'md-wysiwyg-search-panel';
    this.root.style.display = 'none';

    this.queryInput = this.createInput('Find');
    this.replaceInput = this.createInput('Replace');
    this.count = document.createElement('span');
    this.count.className = 'md-wysiwyg-search-count';
    this.matchCase = this.createToggle('Aa', 'Match case');
    this.wholeWord = this.createToggle('W', 'Whole word');
    this.prev = this.createButton('Prev');
    this.next = this.createButton('Next');
    this.replace = this.createButton('Replace');
    this.replaceAll = this.createButton('All');
    this.close = this.createButton('x');
    this.close.title = 'Close search';

    [
      this.queryInput,
      this.replaceInput,
      this.matchCase,
      this.wholeWord,
      this.prev,
      this.next,
      this.replace,
      this.replaceAll,
      this.close,
    ].forEach((element) => this.root.appendChild(element));
    this.root.appendChild(this.count);

    const host = view.dom.closest('.md-wysiwyg-editor') || view.dom.parentElement || document.body;
    host.appendChild(this.root);

    this.queryInput.addEventListener('input', () => this.dispatch({ type: 'query', query: this.queryInput.value }));
    this.replaceInput.addEventListener('input', () => this.dispatch({ type: 'replace', replace: this.replaceInput.value }));
    this.matchCase.addEventListener('click', () => this.dispatch({ type: 'toggleMatchCase' }));
    this.wholeWord.addEventListener('click', () => this.dispatch({ type: 'toggleWholeWord' }));
    this.prev.addEventListener('click', () => this.moveAndReveal(-1));
    this.next.addEventListener('click', () => this.moveAndReveal(1));
    this.replace.addEventListener('click', () => replaceCurrent(this.view, searchReplaceKey.getState(this.view.state)));
    this.replaceAll.addEventListener('click', () => {
      const pluginState = searchReplaceKey.getState(this.view.state);
      if (!pluginState.matches.length) return;
      const ok = window.confirm('Replace all ' + pluginState.matches.length + ' matches?');
      if (ok) replaceAll(this.view, pluginState);
    });
    this.close.addEventListener('click', () => closeSearch(this.view));

    [this.queryInput, this.replaceInput].forEach((input) => {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.moveAndReveal(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeSearch(this.view);
        }
      });
    });
  }

  createInput(placeholder) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.className = 'input-text native-key-bindings';
    input.addEventListener('mousedown', (event) => event.stopPropagation());
    return input;
  }

  createButton(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-xs';
    button.textContent = label;
    button.addEventListener('mousedown', (event) => event.preventDefault());
    return button;
  }

  createToggle(label, title) {
    const button = this.createButton(label);
    button.title = title;
    return button;
  }

  dispatch(meta) {
    this.view.dispatch(this.view.state.tr.setMeta(searchReplaceKey, meta));
  }

  moveAndReveal(delta) {
    this.dispatch({ type: 'move', delta });
    requestAnimationFrame(() => {
      revealActiveMatch(this.view);
      requestAnimationFrame(() => revealActiveMatch(this.view));
    });
  }

  update(view) {
    this.view = view;
    const pluginState = searchReplaceKey.getState(view.state);
    if (!pluginState || !pluginState.show) {
      this.root.style.display = 'none';
      return;
    }

    this.root.style.display = 'grid';
    if (this.queryInput.value !== pluginState.query) this.queryInput.value = pluginState.query;
    if (this.replaceInput.value !== pluginState.replace) this.replaceInput.value = pluginState.replace;
    this.replaceInput.style.display = pluginState.replaceMode ? '' : 'none';
    this.replace.style.display = pluginState.replaceMode ? '' : 'none';
    this.replaceAll.style.display = pluginState.replaceMode ? '' : 'none';
    this.matchCase.classList.toggle('selected', pluginState.matchCase);
    this.wholeWord.classList.toggle('selected', pluginState.wholeWord);
    this.count.textContent = pluginState.matches.length
      ? (pluginState.activeIndex + 1) + ' / ' + pluginState.matches.length
      : '0 / 0';

    if (document.activeElement !== this.queryInput && document.activeElement !== this.replaceInput) {
      this.queryInput.focus();
      this.queryInput.select();
    }

  }

  destroy() {
    this.root.remove();
  }
}

export const searchReplacePlugin = $prose(() => {
  return new Plugin({
    key: searchReplaceKey,
    state: {
      init(_config, state) {
        return createState(state.doc);
      },
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(searchReplaceKey);
        let next = value;
        if (meta) {
          if (meta.type === 'open') next = { ...next, show: true, replaceMode: Boolean(meta.replaceMode) };
          else if (meta.type === 'close') next = { ...next, show: false };
          else if (meta.type === 'query') next = { ...next, query: meta.query || '', activeIndex: 0 };
          else if (meta.type === 'replace') next = { ...next, replace: meta.replace || '' };
          else if (meta.type === 'toggleMatchCase') next = { ...next, matchCase: !next.matchCase, activeIndex: 0 };
          else if (meta.type === 'toggleWholeWord') next = { ...next, wholeWord: !next.wholeWord, activeIndex: 0 };
          else if (meta.type === 'move') next = { ...next, activeIndex: nextIndex(next, meta.delta || 1) };
        }
        if (tr.docChanged || meta) return createState(newState.doc, next);
        return next;
      },
    },
    props: {
      decorations(state) {
        return buildDecorations(state.doc, searchReplaceKey.getState(state));
      },
      handleKeyDown(view, event) {
        const isFind = event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey &&
          event.key.toLowerCase() === 'f';
        const isReplace = event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey &&
          event.key.toLowerCase() === 'r';
        if (isFind || isReplace) {
          event.preventDefault();
          openSearch(view, isReplace);
          return true;
        }
        if (event.key === 'Escape') {
          const pluginState = searchReplaceKey.getState(view.state);
          if (pluginState && pluginState.show) {
            event.preventDefault();
            closeSearch(view);
            return true;
          }
        }
        return false;
      },
    },
    view(view) {
      const panel = new SearchReplaceView(view);
      return {
        update(nextView) {
          panel.update(nextView);
        },
        destroy() {
          panel.destroy();
        },
      };
    },
  });
});

export function openSearchPanel(view, replaceMode = false) {
  openSearch(view, replaceMode);
}
