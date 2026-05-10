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
    return katex.renderToString(value, {
      displayMode,
      throwOnError: true,
      trust: true,
    });
  } catch (e) {
    return '<span class="math-error">' + escapeHTML(value) + '</span>';
  }
}

function createMathNodeView(isBlock) {
  return (node, view, getPos) => {
    const dom = document.createElement(isBlock ? 'div' : 'span');
    dom.classList.add(isBlock ? 'math-block-node' : 'math-inline-node');

    const preview = document.createElement(isBlock ? 'div' : 'span');
    preview.classList.add('math-preview');
    dom.appendChild(preview);

    const source = isBlock ? document.createElement('textarea') : document.createElement('input');
    source.classList.add('math-source');
    if (!isBlock) source.type = 'text';
    source.spellcheck = false;
    source.style.display = 'none';
    dom.appendChild(source);

    let editing = false;

    function getValue() {
      return node.attrs.value || node.textContent;
    }

    function updateNode(value) {
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (typeof pos !== 'number') return;
      const content = value ? node.type.schema.text(value) : null;
      const nextNode = node.type.create({ ...node.attrs, value }, content);
      view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, nextNode));
    }

    function showPreview() {
      editing = false;
      source.style.display = 'none';
      preview.style.display = '';
      preview.innerHTML = renderKatex(getValue(), isBlock);
    }

    function showSource() {
      editing = true;
      preview.style.display = 'none';
      source.style.display = '';
      source.value = getValue();
      setTimeout(() => {
        source.focus();
        source.select();
      }, 0);
    }

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
            if (source.value !== getValue()) source.value = getValue();
          } else {
            preview.innerHTML = renderKatex(getValue(), isBlock);
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
        return event.target === source;
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
