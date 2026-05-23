import { htmlSchema } from '@milkdown/kit/preset/commonmark';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { $view } from './view';

const EDITABLE_TAGS = new Set(['summary', 'kbd', 'mark', 'sub', 'sup', 'u', 'small']);
const VOID_TAGS = new Set(['br', 'hr']);
const SAFE_PLACEHOLDER_TAGS = new Set([
  'details', 'div', 'span', 'iframe', 'video', 'audio', 'table', 'pre', 'code', 'img', 'script',
]);
const detailsStateKey = new PluginKey('md-wysiwyg-html-details');

function stripHtmlText(value) {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  return template.content.textContent || String(value || '');
}

function parseHtmlAtom(value) {
  const source = String(value || '');
  const trimmed = source.trim();
  const summary = trimmed.match(/<summary([^>]*)>([\s\S]*?)<\/summary>/i);
  if (summary) {
    return {
      source,
      tag: 'summary',
      attrs: summary[1] || '',
      body: stripHtmlText(summary[2] || ''),
      summaryInSource: true,
      closing: false,
      opening: false,
      voidTag: false,
    };
  }

  let match = trimmed.match(/^<([A-Za-z][\w:-]*)(\s[^>]*)?>([\s\S]*)<\/\1>$/);
  if (match) {
    return {
      source,
      tag: match[1].toLowerCase(),
      attrs: match[2] || '',
      body: match[3] || '',
      closing: false,
      opening: false,
      voidTag: false,
    };
  }

  match = trimmed.match(/^<([A-Za-z][\w:-]*)(\s[^>]*)?\/?>$/);
  if (match) {
    const tag = match[1].toLowerCase();
    return {
      source,
      tag,
      attrs: match[2] || '',
      body: '',
      closing: false,
      opening: !VOID_TAGS.has(tag),
      voidTag: VOID_TAGS.has(tag) || /\/>$/.test(trimmed),
    };
  }

  match = trimmed.match(/^<\/([A-Za-z][\w:-]*)>$/);
  if (match) {
    return {
      source,
      tag: match[1].toLowerCase(),
      attrs: '',
      body: '',
      closing: true,
      opening: false,
      voidTag: false,
    };
  }

  return { source, tag: '', attrs: '', body: source, closing: false, opening: false, voidTag: false };
}

function isDetailsStart(parsed) {
  return parsed.tag === 'details' && parsed.opening ||
    Boolean(parsed.summaryInSource && /<details\b/i.test(parsed.source));
}

function isDetailsEnd(parsed) {
  return parsed.tag === 'details' && parsed.closing || /<\/details>/i.test(parsed.source);
}

function detailsSourceOpen(parsed) {
  const match = String(parsed.source || '').match(/<details\b([^>]*)>/i);
  return Boolean(match && /\sopen(?:\s|=|$)/i.test(match[1] || ''));
}

function htmlForEditable(tag, attrs, body) {
  return '<' + tag + attrs + '>' + body + '</' + tag + '>';
}

function replaceSummaryBody(source, body) {
  return String(source || '').replace(
    /(<summary[^>]*>)([\s\S]*?)(<\/summary>)/i,
    '$1' + body + '$3'
  );
}

function labelFor(parsed) {
  if (!parsed.tag) return 'HTML';
  if (parsed.closing) return '</' + parsed.tag + '>';
  if (parsed.opening) return '<' + parsed.tag + '>';
  if (parsed.voidTag) return '<' + parsed.tag + '>';
  return parsed.tag;
}

function isComplexPlaceholder(parsed) {
  if (!parsed.tag) return true;
  if (EDITABLE_TAGS.has(parsed.tag) || VOID_TAGS.has(parsed.tag)) return false;
  return SAFE_PLACEHOLDER_TAGS.has(parsed.tag) || parsed.source.includes('\n');
}

function setInputWidth(input) {
  const value = input.value || input.placeholder || '';
  input.style.width = Math.max(3, Math.min(value.length + 1, 56)) + 'ch';
}

function detailsOpenAt(state, pos, parsed) {
  const detailsState = detailsStateKey.getState(state);
  if (detailsState && Object.prototype.hasOwnProperty.call(detailsState.openByPos, pos)) {
    return detailsState.openByPos[pos];
  }
  return detailsSourceOpen(parsed);
}

function findDetailsRanges(doc, openByPos) {
  const ranges = [];
  const stack = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'html') return true;
    const parsed = parseHtmlAtom(node.attrs.value);
    if (isDetailsStart(parsed)) {
      const open = Object.prototype.hasOwnProperty.call(openByPos, pos)
        ? openByPos[pos]
        : detailsSourceOpen(parsed);
      stack.push({ pos, after: pos + node.nodeSize, open });
      if (isDetailsEnd(parsed)) stack.pop();
      return false;
    }
    if (isDetailsEnd(parsed) && stack.length) {
      const start = stack.pop();
      if (start.after < pos) ranges.push({ from: start.after, to: pos, open: start.open });
      return false;
    }
    return false;
  });

  return ranges;
}

function detailsDecorations(doc, openByPos) {
  const decorations = [];
  findDetailsRanges(doc, openByPos).forEach((range) => {
    if (range.open) return;
    decorations.push(Decoration.inline(range.from, range.to, { class: 'md-wysiwyg-details-collapsed-inline' }));
    doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (!node.isBlock) return true;
      if (pos < range.from || pos + node.nodeSize > range.to) return true;
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'md-wysiwyg-details-collapsed-block' }));
      return false;
    });
  });
  return DecorationSet.create(doc, decorations);
}

const detailsDisclosurePlugin = $prose(() => {
  return new Plugin({
    key: detailsStateKey,
    state: {
      init(_, state) {
        return { openByPos: {}, decorations: detailsDecorations(state.doc, {}) };
      },
      apply(tr, value, _oldState, newState) {
        let openByPos = value.openByPos;
        if (tr.docChanged) {
          const mapped = {};
          Object.keys(openByPos).forEach((key) => {
            const pos = Number(key);
            const mappedPos = tr.mapping.map(pos, -1);
            if (mappedPos >= 0 && mappedPos <= newState.doc.content.size) {
              mapped[mappedPos] = openByPos[key];
            }
          });
          openByPos = mapped;
        }

        const meta = tr.getMeta(detailsStateKey);
        if (meta && meta.type === 'set-open') {
          openByPos = { ...openByPos, [meta.pos]: Boolean(meta.open) };
        }

        return { openByPos, decorations: detailsDecorations(newState.doc, openByPos) };
      },
    },
    props: {
      decorations(state) {
        const detailsState = detailsStateKey.getState(state);
        return detailsState ? detailsState.decorations : DecorationSet.empty;
      },
    },
  });
});

const htmlNodeView = $view(htmlSchema, () => {
  return (node, view, getPos) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'md-wysiwyg-html-node';
    wrapper.contentEditable = 'false';

    let parsed = parseHtmlAtom(node.attrs.value);
    let input = null;

    function nodePos() {
      if (typeof getPos !== 'function') return -1;
      try {
        const pos = getPos();
        return typeof pos === 'number' ? pos : -1;
      } catch (_err) {
        return -1;
      }
    }

    function updateValue(nextValue) {
      const pos = nodePos();
      if (pos < 0 || nextValue === node.attrs.value) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, node.type, { ...node.attrs, value: nextValue }, node.marks));
    }

    function appendEditableInput(className = '') {
      input = document.createElement('input');
      input.className = ('md-wysiwyg-html-input native-key-bindings ' + className).trim();
      input.type = 'text';
      input.value = parsed.body;
      input.spellcheck = false;
      input.setAttribute('aria-label', parsed.tag + ' text');
      setInputWidth(input);
      wrapper.appendChild(input);

      input.addEventListener('input', () => {
        setInputWidth(input);
        updateValue(parsed.summaryInSource
          ? replaceSummaryBody(parsed.source, input.value)
          : htmlForEditable(parsed.tag, parsed.attrs, input.value));
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          view.focus();
        }
      });
    }

    function renderEditable() {
      wrapper.classList.add('md-wysiwyg-html-inline', 'html-' + parsed.tag);
      appendEditableInput();
    }

    function renderSummary() {
      wrapper.classList.add('md-wysiwyg-html-summary', 'html-summary');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'md-wysiwyg-html-summary-toggle';
      wrapper.appendChild(toggle);

      function syncToggle() {
        const pos = nodePos();
        const open = pos >= 0 ? detailsOpenAt(view.state, pos, parsed) : detailsSourceOpen(parsed);
        toggle.textContent = open ? '▾' : '▸';
        toggle.title = open ? 'Collapse details' : 'Expand details';
        wrapper.classList.toggle('open', open);
      }

      toggle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const pos = nodePos();
        if (pos < 0) return;
        const open = detailsOpenAt(view.state, pos, parsed);
        view.dispatch(view.state.tr.setMeta(detailsStateKey, { type: 'set-open', pos, open: !open }));
        syncToggle();
      });

      appendEditableInput('md-wysiwyg-html-summary-input');
      syncToggle();
    }

    function renderVoid() {
      wrapper.classList.add('md-wysiwyg-html-void', 'html-' + parsed.tag);
      wrapper.textContent = parsed.tag === 'br' ? '' : '';
      wrapper.title = parsed.source;
    }

    function renderDetailsBoundary() {
      wrapper.classList.add('md-wysiwyg-html-details-boundary');
      wrapper.title = parsed.source;
    }

    function renderPlaceholder() {
      wrapper.classList.add('md-wysiwyg-html-placeholder');
      if (parsed.tag) wrapper.classList.add('html-' + parsed.tag);

      const label = document.createElement('span');
      label.className = 'md-wysiwyg-html-tag';
      label.textContent = labelFor(parsed);
      wrapper.appendChild(label);
      wrapper.title = parsed.source;
    }

    function render() {
      wrapper.textContent = '';
      wrapper.className = 'md-wysiwyg-html-node';
      parsed = parseHtmlAtom(node.attrs.value);
      input = null;

      if (parsed.tag === 'summary' && parsed.summaryInSource) {
        renderSummary();
      } else if (parsed.tag === 'details' && (parsed.opening || parsed.closing)) {
        renderDetailsBoundary();
      } else if (EDITABLE_TAGS.has(parsed.tag) && !parsed.opening && !parsed.closing && !parsed.voidTag) {
        renderEditable();
      } else if (VOID_TAGS.has(parsed.tag)) {
        renderVoid();
      } else if (isComplexPlaceholder(parsed)) {
        renderPlaceholder();
      } else {
        renderPlaceholder();
      }
    }

    wrapper.addEventListener('mousedown', (event) => {
      if (event.target === input) event.stopPropagation();
    });
    wrapper.addEventListener('click', (event) => {
      if (event.target === input) event.stopPropagation();
    });

    render();

    return {
      dom: wrapper,
      update(newNode) {
        if (newNode.type.name !== node.type.name) return false;
        node = newNode;
        if (document.activeElement !== input) render();
        return true;
      },
      selectNode() {
        wrapper.classList.add('selected');
        if (input) {
          setTimeout(() => {
            input.focus();
            input.select();
          }, 0);
        }
      },
      deselectNode() {
        wrapper.classList.remove('selected');
      },
      stopEvent(event) {
        return (input && event.target === input) ||
          event.target.classList.contains('md-wysiwyg-html-summary-toggle');
      },
      ignoreMutation() {
        return true;
      },
    };
  };
});

export const htmlCompatibilityPlugin = [detailsDisclosurePlugin, htmlNodeView];
