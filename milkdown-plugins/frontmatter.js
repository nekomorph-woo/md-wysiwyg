import { TextSelection } from '@milkdown/kit/prose/state';

const FRONTMATTER_LANGUAGE = 'frontmatter';

function frontMatterMatch(markdown) {
  return String(markdown || '').match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
}

export function prepareMarkdownForEditor(markdown) {
  const source = String(markdown || '');
  const match = frontMatterMatch(source);
  if (!match) return source;

  const value = match[1] || '';
  const rest = source.slice(match[0].length);
  return '```' + FRONTMATTER_LANGUAGE + '\n' + value + '\n```\n\n' + rest.replace(/^\n+/, '');
}

export function restoreMarkdownFromEditor(markdown) {
  const source = String(markdown || '');
  const match = source.match(/^```frontmatter[^\n]*\n([\s\S]*?)\n```[ \t]*(?:\r?\n|$)/);
  if (!match) return source;

  const value = match[1] || '';
  const rest = source.slice(match[0].length).replace(/^\n+/, '');
  return '---\n' + value + '\n---\n' + rest;
}

function frontMatterSummary(value) {
  const lines = String(value || '').split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
  const keys = lines
    .map((line) => {
      const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:/);
      return match ? match[1] : null;
    })
    .filter(Boolean);
  if (keys.length === 0) return 'YAML metadata';
  const visible = keys.slice(0, 3).join(', ');
  return keys.length > 3 ? visible + ' +' + (keys.length - 3) : visible;
}

export function createFrontMatterView(node, view, getPos) {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-wysiwyg-frontmatter';

  const header = document.createElement('div');
  header.className = 'md-wysiwyg-frontmatter-header';
  header.contentEditable = 'false';
  wrapper.appendChild(header);

  const label = document.createElement('span');
  label.className = 'md-wysiwyg-frontmatter-label';
  label.textContent = 'Front Matter';
  header.appendChild(label);

  const summary = document.createElement('span');
  summary.className = 'md-wysiwyg-frontmatter-summary';
  header.appendChild(summary);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn md-wysiwyg-frontmatter-toggle';
  header.appendChild(toggle);

  const source = document.createElement('textarea');
  source.className = 'md-wysiwyg-frontmatter-source native-key-bindings';
  source.spellcheck = false;
  wrapper.appendChild(source);

  let expanded = false;

  function nodePos() {
    if (typeof getPos !== 'function') return -1;
    try {
      const pos = getPos();
      return typeof pos === 'number' ? pos : -1;
    } catch (_err) {
      return -1;
    }
  }

  function value() {
    return node.textContent || '';
  }

  function render() {
    source.value = value();
    summary.textContent = frontMatterSummary(value());
    source.style.display = expanded ? 'block' : 'none';
    toggle.textContent = expanded ? 'Hide' : 'Edit';
    wrapper.classList.toggle('expanded', expanded);
  }

  function updateNode(nextValue) {
    const pos = nodePos();
    if (pos < 0 || nextValue === value()) return;
    const content = nextValue ? node.type.schema.text(nextValue) : null;
    const nextNode = node.type.create({ ...node.attrs, language: FRONTMATTER_LANGUAGE }, content, node.marks);
    let tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, nextNode);
    const offset = typeof source.selectionStart === 'number'
      ? Math.max(0, Math.min(source.selectionStart, nextValue.length))
      : nextValue.length;
    tr = tr.setSelection(TextSelection.create(tr.doc, Math.min(pos + 1 + offset, tr.doc.content.size)));
    view.dispatch(tr);
  }

  function setExpanded(nextExpanded, focusSource = false) {
    expanded = nextExpanded;
    render();
    if (focusSource) {
      setTimeout(() => {
        source.focus();
      }, 0);
    }
  }

  toggle.addEventListener('mousedown', (event) => event.preventDefault());
  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    setExpanded(!expanded, !expanded);
  });
  source.addEventListener('input', () => updateNode(source.value));
  source.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setExpanded(false);
      view.focus();
    }
  });

  render();

  return {
    dom: wrapper,
    update(newNode) {
      if (newNode.type.name !== node.type.name || newNode.attrs.language !== FRONTMATTER_LANGUAGE) {
        return false;
      }
      node = newNode;
      if (document.activeElement !== source) render();
      return true;
    },
    selectNode() {
      setExpanded(true, true);
    },
    deselectNode() {
      setExpanded(false);
    },
    stopEvent(event) {
      return header.contains(event.target) || event.target === source;
    },
    ignoreMutation() {
      return true;
    },
  };
}

export { FRONTMATTER_LANGUAGE };
