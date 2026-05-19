import remarkMath from 'remark-math';
import katex from 'katex';
import { $node, $remark } from '@milkdown/kit/utils';
import { $view as patchedView } from './view';

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderKatex(value, displayMode) {
  try {
    const allowUnsafeRendering = typeof atom !== 'undefined' && atom.config
      ? Boolean(atom.config.get('md-wysiwyg.allowUnsafeRendering'))
      : false;

    return {
      html: katex.renderToString(value, {
        displayMode,
        throwOnError: true,
        trust: allowUnsafeRendering,
      }),
      error: '',
    };
  } catch (e) {
    return {
      html: '<span class="math-error-source">' + escapeHTML(value) + '</span>',
      error: e && e.message ? e.message : String(e),
    };
  }
}

function createMathNodeView(isBlock) {
  return (node, view, getPos) => {
    const dom = document.createElement(isBlock ? 'div' : 'span');
    dom.classList.add(isBlock ? 'math-block-node' : 'math-inline-node');

    const header = document.createElement('div');
    header.classList.add('math-header');
    header.contentEditable = 'false';

    const sourceButton = document.createElement('button');
    sourceButton.type = 'button';
    sourceButton.className = 'btn math-mode-button';
    sourceButton.textContent = 'Source';
    header.appendChild(sourceButton);

    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'btn math-mode-button';
    previewButton.textContent = 'Preview';
    header.appendChild(previewButton);

    ['\\frac{}{}', '\\sqrt{}', '\\sum', '\\int', '\\alpha', '\\beta', '\\rightarrow'].forEach((symbol) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn math-symbol-button';
      button.textContent = symbol.replace(/\\/g, '');
      button.title = symbol;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        showSource(false);
        const start = source.selectionStart || 0;
        const end = source.selectionEnd || start;
        const value = source.value.slice(0, start) + symbol + source.value.slice(end);
        source.value = value;
        updateNode(value);
        source.focus();
        source.setSelectionRange(start + symbol.length, start + symbol.length);
      });
      header.appendChild(button);
    });

    if (isBlock) dom.appendChild(header);

    const preview = document.createElement(isBlock ? 'div' : 'span');
    preview.classList.add('math-preview');
    dom.appendChild(preview);

    const source = isBlock ? document.createElement('textarea') : document.createElement('input');
    source.classList.add('math-source');
    source.classList.add('native-key-bindings');
    if (!isBlock) source.type = 'text';
    source.spellcheck = false;
    source.style.display = 'none';
    dom.appendChild(source);

    const error = document.createElement(isBlock ? 'div' : 'span');
    error.classList.add('math-error-detail');
    error.style.display = 'none';
    dom.appendChild(error);

    let editing = false;
    let mode = 'preview';

    function getValue() {
      return node.attrs.value || node.textContent;
    }

    function nodePos() {
      if (typeof getPos !== 'function') return -1;
      try {
        const pos = getPos();
        return typeof pos === 'number' ? pos : -1;
      } catch (_err) {
        return -1;
      }
    }

    function updateButtons() {
      sourceButton.classList.toggle('selected', mode === 'source');
      previewButton.classList.toggle('selected', mode === 'preview');
    }

    function updateNode(value) {
      const pos = nodePos();
      if (pos < 0 || value === getValue()) return;
      const content = value ? node.type.schema.text(value) : null;
      const nextNode = node.type.create({ ...node.attrs, value }, content);
      view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, nextNode));
    }

    function renderPreview(value) {
      const result = renderKatex(value, isBlock);
      preview.innerHTML = result.html;
      error.textContent = result.error ? 'KaTeX error: ' + result.error : '';
      error.style.display = result.error ? '' : 'none';
    }

    function showPreview() {
      const value = editing ? source.value : getValue();
      editing = false;
      mode = 'preview';
      updateNode(value);
      source.style.display = 'none';
      preview.style.display = '';
      updateButtons();
      renderPreview(value);
    }

    function showSource(selectAll = true) {
      editing = true;
      mode = 'source';
      preview.style.display = 'none';
      source.style.display = isBlock ? 'block' : 'inline-block';
      source.value = getValue();
      updateButtons();
      setTimeout(() => {
        source.focus();
        if (selectAll) source.select();
      }, 0);
    }

    preview.addEventListener('click', (event) => {
      event.preventDefault();
      showSource();
    });
    sourceButton.addEventListener('mousedown', (event) => event.preventDefault());
    previewButton.addEventListener('mousedown', (event) => event.preventDefault());
    sourceButton.addEventListener('click', (event) => {
      event.preventDefault();
      showSource();
    });
    previewButton.addEventListener('click', (event) => {
      event.preventDefault();
      showPreview();
      view.focus();
    });
    source.addEventListener('input', () => updateNode(source.value));
    source.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        showPreview();
        view.focus();
      }
    });

    showPreview();

    return {
      dom,
      update(newNode) {
        if (newNode.type.name !== node.type.name) return false;
        const changed = newNode.textContent !== node.textContent ||
          newNode.attrs.value !== node.attrs.value;
        node = newNode;
        if (changed) {
          if (editing) {
            if (document.activeElement !== source && source.value !== getValue()) {
              source.value = getValue();
            }
          } else {
            renderPreview(getValue());
          }
        }
        return true;
      },
      selectNode() {
        dom.classList.add('math-selected');
        showSource();
      },
      deselectNode() {
        dom.classList.remove('math-selected');
        showPreview();
      },
      stopEvent(event) {
        return event.target === source || header.contains(event.target);
      },
      destroy() {},
    };
  };
}

const mathInlineSchema = (ctx) => ({
  content: 'text*',
  group: 'inline',
  inline: true,
  atom: true,
  attrs: { value: { default: '' } },
  parseDOM: [{ tag: 'span.math-inline', getAttrs: (node) => ({ value: node.getAttribute('data-value') }) }],
  toDOM: (node) => ['span', { class: 'math-inline', 'data-value': node.attrs.value }, node.textContent],
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => {
      state.openNode(type, { value: node.value });
      state.addText(node.value);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_inline',
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, node.attrs.value || node.textContent);
    },
  },
});

const mathBlockSchema = (ctx) => ({
  content: 'text*',
  group: 'block',
  atom: true,
  code: true,
  attrs: { value: { default: '' } },
  parseDOM: [{ tag: 'div.math-block', getAttrs: (node) => ({ value: node.getAttribute('data-value') }) }],
  toDOM: (node) => ['div', { class: 'math-block math-display', 'data-value': node.attrs.value }, node.textContent],
  parseMarkdown: {
    match: (node) => node.type === 'math',
    runner: (state, node, type) => {
      state.openNode(type, { value: node.value });
      state.addText(node.value);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_block',
    runner: (state, node) => {
      state.addNode('math', undefined, node.attrs.value || node.textContent);
    },
  },
});

export const mathRemark = $remark('mathRemark', () => remarkMath);
export const mathInlineNode = $node('math_inline', mathInlineSchema);
export const mathBlockNode = $node('math_block', mathBlockSchema);
export const mathInlineViewPlugin = patchedView(mathInlineNode, () => createMathNodeView(false));
export const mathBlockViewPlugin = patchedView(mathBlockNode, () => createMathNodeView(true));

export const mathPlugin = [mathRemark, mathInlineNode, mathBlockNode, mathInlineViewPlugin, mathBlockViewPlugin];
