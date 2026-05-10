import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import { $view } from './view';
import { createMermaidView } from './mermaid';

let hljs = null;

function getHighlightJS() {
  if (hljs) return hljs;
  try {
    hljs = require('highlight.js/lib/core');
    const LANGS = [
      ['javascript', 'javascript'], ['typescript', 'typescript'],
      ['python', 'python'], ['java', 'java'],
      ['cpp', 'cpp'], ['c', 'c'], ['go', 'go'],
      ['rust', 'rust'], ['ruby', 'ruby'], ['php', 'php'],
      ['xml', 'xml'], ['css', 'css'], ['json', 'json'],
      ['yaml', 'yaml'], ['bash', 'bash'], ['sql', 'sql'],
      ['markdown', 'markdown'], ['plaintext', 'plaintext'],
    ];
    for (const [name, mod] of LANGS) {
      try { hljs.registerLanguage(name, require('highlight.js/lib/languages/' + mod)); }
      catch (_e) { /* skip */ }
    }
    return hljs;
  } catch (_e) {
    return null;
  }
}

const LANG_ALIASES = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', sh: 'bash', yml: 'yaml', md: 'markdown',
  plain: 'plaintext', text: 'plaintext', html: 'xml',
};

function resolveLanguage(lang) {
  return LANG_ALIASES[lang] || lang;
}

export const codeBlockViewPlugin = $view(codeBlockSchema, () => {
  return (node, view, getPos) => {
    if (node.attrs.language === 'mermaid') {
      return createMermaidView(node, view, getPos);
    }

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = node.textContent;
    pre.appendChild(code);

    function highlight() {
      const hl = getHighlightJS();
      if (!hl) return;
      const language = resolveLanguage(node.attrs.language || '');
      if (!language) return;
      try {
        const result = hl.highlight(node.textContent, { language });
        code.innerHTML = result.value;
      } catch (_e) { /* skip */ }
    }

    highlight();

    return {
      dom: pre,
      contentDOM: code,
      update(newNode) {
        if (newNode.type.name !== 'code_block') return false;
        node = newNode;
        code.textContent = node.textContent;
        highlight();
        return true;
      },
      ignoreMutation(record) {
        return record.type === 'childList';
      },
      destroy() {},
    };
  };
});
