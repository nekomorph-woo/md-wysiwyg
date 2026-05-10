import remarkMath from 'remark-math';
import katex from 'katex';
import { $node, $view, $remark } from '@milkdown/kit/utils';
import { $view as patchedView } from './view';

function renderKatex(value, displayMode) {
  try {
    return katex.renderToString(value, {
      displayMode,
      throwOnError: true,
      trust: true,
    });
  } catch (e) {
    return '<span class="math-error">' + value + '</span>';
  }
}

function createMathNodeView(isBlock) {
  return (node) => {
    const dom = document.createElement(isBlock ? 'div' : 'span');
    dom.classList.add(isBlock ? 'math-block-node' : 'math-inline-node');
    dom.innerHTML = renderKatex(node.textContent, isBlock);

    return {
      dom,
      update(newNode) {
        if (newNode.type.name !== node.type.name) return false;
        if (newNode.textContent !== node.textContent) {
          dom.innerHTML = renderKatex(newNode.textContent, isBlock);
        }
        node = newNode;
        return true;
      },
      selectNode() {
        dom.classList.add('math-selected');
        dom.textContent = node.textContent;
      },
      deselectNode() {
        dom.classList.remove('math-selected');
        dom.innerHTML = renderKatex(node.textContent, isBlock);
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
