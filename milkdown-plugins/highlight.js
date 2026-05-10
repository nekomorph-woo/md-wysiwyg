import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { $view } from './view';
import { createMermaidView } from './mermaid';

let hljs = null;

const LANGS = [
  ['javascript', 'javascript'], ['typescript', 'typescript'],
  ['python', 'python'], ['java', 'java'],
  ['cpp', 'cpp'], ['c', 'c'], ['go', 'go'],
  ['rust', 'rust'], ['ruby', 'ruby'], ['php', 'php'],
  ['xml', 'xml'], ['css', 'css'], ['json', 'json'],
  ['yaml', 'yaml'], ['bash', 'bash'], ['sql', 'sql'],
  ['markdown', 'markdown'], ['plaintext', 'plaintext'],
];

const LANG_ALIASES = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', sh: 'bash', yml: 'yaml', md: 'markdown',
  plain: 'plaintext', text: 'plaintext', html: 'xml',
};

function getHighlightJS() {
  if (hljs) return hljs;
  try {
    hljs = require('highlight.js/lib/core');
    for (const [name, mod] of LANGS) {
      try { hljs.registerLanguage(name, require('highlight.js/lib/languages/' + mod)); }
      catch (_e) { /* skip missing languages in packaged builds */ }
    }
    return hljs;
  } catch (_e) {
    return null;
  }
}

function resolveLanguage(lang) {
  const name = (lang || '').toLowerCase();
  return LANG_ALIASES[name] || name;
}

function collectHighlightRanges(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const ranges = [];
  let offset = 0;

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.nodeValue.length;
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const start = offset;
    node.childNodes.forEach(walk);
    const end = offset;
    const className = node.getAttribute('class');
    if (className && end > start) {
      ranges.push({ from: start, to: end, className });
    }
  }

  template.content.childNodes.forEach(walk);
  return ranges;
}

function highlightRanges(text, language) {
  const hl = getHighlightJS();
  if (!hl || !language || !hl.getLanguage(language)) return [];

  try {
    const result = hl.highlight(text, { language, ignoreIllegals: true });
    return collectHighlightRanges(result.value);
  } catch (_e) {
    return [];
  }
}

const syntaxHighlightPlugin = $prose((ctx) => {
  const codeBlockType = codeBlockSchema.type(ctx);

  return new Plugin({
    props: {
      decorations(state) {
        const decorations = [];

        state.doc.descendants((node, pos) => {
          if (node.type !== codeBlockType) return true;
          if (node.attrs.language === 'mermaid') return false;

          const language = resolveLanguage(node.attrs.language);
          const ranges = highlightRanges(node.textContent, language);
          for (const range of ranges) {
            decorations.push(Decoration.inline(
              pos + 1 + range.from,
              pos + 1 + range.to,
              { class: range.className }
            ));
          }

          return false;
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
});

const codeBlockNodeView = $view(codeBlockSchema, () => {
  return (node, view, getPos) => {
    if (node.attrs.language === 'mermaid') {
      return createMermaidView(node, view, getPos);
    }

    const pre = document.createElement('pre');
    pre.classList.add('hljs');
    const code = document.createElement('code');
    pre.appendChild(code);

    function updateLanguageClass() {
      const language = resolveLanguage(node.attrs.language);
      code.className = language ? 'language-' + language : '';
    }

    updateLanguageClass();

    return {
      dom: pre,
      contentDOM: code,
      update(newNode) {
        if (newNode.type.name !== 'code_block') return false;
        if (newNode.attrs.language === 'mermaid') return false;
        node = newNode;
        updateLanguageClass();
        return true;
      },
      destroy() {},
    };
  };
});

export const codeBlockViewPlugin = [syntaxHighlightPlugin, codeBlockNodeView];
