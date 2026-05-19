import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { runEditorCommand } from './editor-commands';

const slashCommandKey = new PluginKey('md-wysiwyg-slash-command');

const ITEMS = [
  { label: 'Heading 1', keywords: 'h1 title heading', command: 'heading', payload: { level: 1 } },
  { label: 'Heading 2', keywords: 'h2 section heading', command: 'heading', payload: { level: 2 } },
  { label: 'Heading 3', keywords: 'h3 heading', command: 'heading', payload: { level: 3 } },
  { label: 'Bullet List', keywords: 'ul bullet list', command: 'bulletList' },
  { label: 'Ordered List', keywords: 'ol ordered list number', command: 'orderedList' },
  { label: 'Task List', keywords: 'todo checkbox task', command: 'taskList' },
  { label: 'Quote', keywords: 'blockquote quote', command: 'blockquote' },
  { label: 'Code Block', keywords: 'code fence block', command: 'codeBlock' },
  { label: 'Mermaid', keywords: 'diagram flowchart graph mermaid', command: 'mermaid' },
  { label: 'Divider', keywords: 'hr horizontal rule divider', command: 'horizontalRule' },
];

function createMenu() {
  const menu = document.createElement('div');
  menu.className = 'md-wysiwyg-slash-menu';
  menu.setAttribute('role', 'listbox');
  menu.style.display = 'none';
  return menu;
}

function getQuery(state, slashPos) {
  if (slashPos < 0 || slashPos >= state.selection.from) return null;
  const text = state.doc.textBetween(slashPos, state.selection.from, '', '');
  if (!text.startsWith('/')) return null;
  if (/\s/.test(text)) return null;
  return text.slice(1).toLowerCase();
}

function filteredItems(query) {
  if (!query) return ITEMS;
  return ITEMS.filter((item) => {
    const haystack = (item.label + ' ' + item.keywords).toLowerCase();
    return haystack.includes(query);
  });
}

function removeQuery(view, slashPos) {
  const { state } = view;
  if (slashPos < 0 || slashPos > state.selection.from) return null;
  return state.tr.delete(slashPos, state.selection.from);
}

class SlashCommandView {
  constructor(view) {
    this.view = view;
    this.menu = createMenu();
    this.active = false;
    this.slashPos = -1;
    this.selectedIndex = 0;
    this.items = ITEMS;
    this.composing = false;

    this.onMouseDown = (event) => event.preventDefault();
    this.menu.addEventListener('mousedown', this.onMouseDown);
    document.body.appendChild(this.menu);
    this.render();
  }

  update(view, prevState) {
    this.view = view;
    const state = view.state;
    if (this.composing || !state.selection.empty) {
      this.close();
      return;
    }

    if (prevState && prevState.selection.eq(state.selection) && prevState.doc.eq(state.doc)) {
      return;
    }

    if (!this.active) return;
    const query = getQuery(state, this.slashPos);
    if (query == null) {
      this.close();
      return;
    }
    this.items = filteredItems(query);
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(this.items.length - 1, 0));
    this.render();
    this.position();
  }

  start(slashPos) {
    this.active = true;
    this.slashPos = slashPos;
    this.selectedIndex = 0;
    this.items = filteredItems('');
    this.render();
    this.position();
  }

  close() {
    this.active = false;
    this.slashPos = -1;
    this.menu.style.display = 'none';
  }

  move(delta) {
    if (!this.active || this.items.length === 0) return false;
    this.selectedIndex = (this.selectedIndex + delta + this.items.length) % this.items.length;
    this.render();
    return true;
  }

  execute(index = this.selectedIndex) {
    if (!this.active || !this.items[index]) return false;
    const item = this.items[index];
    const tr = removeQuery(this.view, this.slashPos);
    if (!tr) return false;
    this.view.dispatch(tr);
    this.close();
    return runEditorCommand(this.view, item.command, item.payload);
  }

  render() {
    this.menu.innerHTML = '';

    if (!this.active || this.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'md-wysiwyg-slash-empty';
      empty.textContent = 'No commands';
      this.menu.appendChild(empty);
      return;
    }

    this.items.forEach((item, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'md-wysiwyg-slash-item';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', index === this.selectedIndex ? 'true' : 'false');
      option.textContent = item.label;
      option.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.render();
      });
      option.addEventListener('click', (event) => {
        event.preventDefault();
        this.execute(index);
      });
      this.menu.appendChild(option);
    });
  }

  position() {
    if (!this.active) return;
    try {
      const gap = 6;
      const margin = 8;
      const coords = this.view.coordsAtPos(this.view.state.selection.from);
      this.menu.style.display = 'block';
      const height = this.menu.offsetHeight || 0;
      const width = this.menu.offsetWidth || 0;
      const belowTop = coords.bottom + gap;
      const aboveTop = coords.top - gap - height;
      const hasRoomBelow = belowTop + height <= window.innerHeight - margin;
      const top = hasRoomBelow
        ? belowTop
        : Math.max(margin, aboveTop);
      const left = Math.min(
        Math.max(margin, coords.left),
        Math.max(margin, window.innerWidth - width - margin)
      );
      this.menu.style.left = left + 'px';
      this.menu.style.top = top + 'px';
    } catch (_err) {
      this.close();
    }
  }

  destroy() {
    this.menu.removeEventListener('mousedown', this.onMouseDown);
    this.menu.remove();
  }
}

export const slashCommandPlugin = $prose(() => {
  let pluginView = null;

  return new Plugin({
    key: slashCommandKey,
    view(view) {
      pluginView = new SlashCommandView(view);
      return {
        update(view, prevState) {
          pluginView.update(view, prevState);
        },
        destroy() {
          pluginView.destroy();
          pluginView = null;
        },
      };
    },
    props: {
      handleDOMEvents: {
        compositionstart(_view, _event) {
          if (pluginView) pluginView.composing = true;
          return false;
        },
        compositionend(_view, _event) {
          if (pluginView) pluginView.composing = false;
          return false;
        },
      },
      handleTextInput(view, from, to, text) {
        if (text !== '/' || from !== to) return false;
        const $from = view.state.doc.resolve(from);
        if ($from.parent.type.name === 'code_block') return false;
        const before = view.state.doc.textBetween(Math.max($from.start(), from - 1), from, '', '');
        if (before && !/\s/.test(before)) return false;

        setTimeout(() => {
          if (pluginView) pluginView.start(from);
        }, 0);
        return false;
      },
      handleKeyDown(view, event) {
        if (!pluginView || !pluginView.active) return false;

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          return pluginView.move(1);
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          return pluginView.move(-1);
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          return pluginView.execute();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          pluginView.close();
          return true;
        }
        return false;
      },
    },
  });
});
