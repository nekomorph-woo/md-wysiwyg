import { Selection, TextSelection } from '@milkdown/kit/prose/state';

let mermaidInstance = null;

function currentTheme() {
  return 'base';
}

function currentThemeVariables() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    return {
      background: 'transparent',
      primaryColor: '#eef6ff',
      primaryBorderColor: '#5b8ec9',
      primaryTextColor: '#1f2f46',
      secondaryColor: '#f4f7ec',
      secondaryBorderColor: '#89a85a',
      secondaryTextColor: '#26351e',
      tertiaryColor: '#fff4e6',
      tertiaryBorderColor: '#d59b4b',
      tertiaryTextColor: '#3e2a14',
      lineColor: '#6f7f95',
      textColor: '#243447',
      mainBkg: '#eef6ff',
      nodeBorder: '#5b8ec9',
      clusterBkg: '#f8fafc',
      clusterBorder: '#c6ced8',
      edgeLabelBackground: '#f8fafc',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    };
  }

  return {
    background: 'transparent',
    primaryColor: '#26384f',
    primaryBorderColor: '#78a6d8',
    primaryTextColor: '#e7edf5',
    secondaryColor: '#2f3f34',
    secondaryBorderColor: '#8bb174',
    secondaryTextColor: '#ecf4e9',
    tertiaryColor: '#4a3928',
    tertiaryBorderColor: '#d2a15d',
    tertiaryTextColor: '#fff1df',
    lineColor: '#a2adba',
    textColor: '#e7edf5',
    mainBkg: '#26384f',
    nodeBorder: '#78a6d8',
    clusterBkg: '#202833',
    clusterBorder: '#4d5a68',
    edgeLabelBackground: '#202833',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  };
}

function securityLevel() {
  const allowUnsafeRendering = typeof atom !== 'undefined' && atom.config
    ? Boolean(atom.config.get('md-wysiwyg.allowUnsafeRendering'))
    : false;
  return allowUnsafeRendering ? 'loose' : 'strict';
}

function initializeMermaid(mermaid) {
  mermaid.initialize({
    startOnLoad: false,
    theme: currentTheme(),
    themeVariables: currentThemeVariables(),
    securityLevel: securityLevel(),
  });
}

export function loadMermaid() {
  if (mermaidInstance) return Promise.resolve(mermaidInstance);
  return new Promise((resolve, reject) => {
    try {
      const mod = require('./mermaid-bundle.cjs');
      mermaidInstance = mod.default || mod;
      initializeMermaid(mermaidInstance);
      resolve(mermaidInstance);
    } catch (err) {
      console.error('md-wysiwyg: Failed to load mermaid', err);
      reject(err);
    }
  });
}

export function createMermaidView(node, view, getPos) {
  let renderTimeout = null;
  let currentSrc = '';
  let renderVersion = 0;

  const wrapper = document.createElement('div');
  wrapper.classList.add('mermaid-wrapper');

  const header = document.createElement('div');
  header.classList.add('mermaid-header');
  header.contentEditable = 'false';
  wrapper.appendChild(header);

  const sourceButton = document.createElement('button');
  sourceButton.type = 'button';
  sourceButton.className = 'btn mermaid-mode-button';
  sourceButton.textContent = 'Source';
  sourceButton.title = 'Edit Mermaid source';
  header.appendChild(sourceButton);

  const previewButton = document.createElement('button');
  previewButton.type = 'button';
  previewButton.className = 'btn mermaid-mode-button';
  previewButton.textContent = 'Preview';
  previewButton.title = 'Render Mermaid preview';
  header.appendChild(previewButton);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn mermaid-mode-button mermaid-delete-button';
  deleteButton.textContent = 'Delete';
  deleteButton.title = 'Delete Mermaid diagram';
  header.appendChild(deleteButton);

  const preview = document.createElement('div');
  preview.classList.add('mermaid-preview');
  wrapper.appendChild(preview);

  const srcEl = document.createElement('textarea');
  srcEl.classList.add('mermaid-source');
  srcEl.classList.add('native-key-bindings');
  srcEl.spellcheck = false;
  wrapper.appendChild(srcEl);

  let isFocused = false;
  let mode = 'preview';

  function updateModeButtons() {
    wrapper.dataset.mode = mode;
    sourceButton.classList.toggle('selected', mode === 'source');
    previewButton.classList.toggle('selected', mode === 'preview');
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

  function showSource() {
    isFocused = true;
    mode = 'source';
    srcEl.style.display = 'block';
    preview.style.display = 'none';
    const text = node.textContent;
    srcEl.value = text;
    currentSrc = text;
    updateModeButtons();
    setTimeout(() => srcEl.focus(), 0);
  }

  function showPreview() {
    const source = mode === 'source' ? srcEl.value : node.textContent;
    isFocused = false;
    mode = 'preview';
    updateNode(source);
    srcEl.style.display = 'none';
    preview.style.display = 'flex';
    currentSrc = source;
    updateModeButtons();
    scheduleRender(currentSrc);
  }

  function scheduleRender(src) {
    if (renderTimeout) clearTimeout(renderTimeout);
    const delay = (typeof atom !== 'undefined' && atom.config)
      ? (atom.config.get('md-wysiwyg.mermaidRenderDelay') || 500)
      : 500;
    const version = ++renderVersion;
    renderTimeout = setTimeout(() => renderDiagram(src, version), delay);
  }

  async function renderDiagram(src, version) {
    if (!src.trim()) {
      preview.textContent = '';
      const placeholder = document.createElement('span');
      placeholder.classList.add('mermaid-placeholder');
      placeholder.textContent = 'Click to edit Mermaid diagram';
      preview.appendChild(placeholder);
      return;
    }
    const id = 'mermaid-' + Math.random().toString(36).slice(2, 8);
    try {
      const mermaid = await loadMermaid();
      if (!mermaid) {
        preview.textContent = src;
        return;
      }
      const { svg } = await mermaid.render(id, src);
      if (version !== renderVersion) return;
      preview.innerHTML = svg;
    } catch (err) {
      if (version !== renderVersion) return;
      console.error('md-wysiwyg: mermaid render error', err);
      const orphan = document.getElementById('d' + id);
      if (orphan) orphan.remove();
      preview.textContent = '';
      const error = document.createElement('span');
      error.classList.add('mermaid-error');
      error.textContent = 'Mermaid error: ' + (err.message || err);
      preview.appendChild(error);
    }
  }

  function updateNode(value, preserveSourceSelection = false) {
    const pos = nodePos();
    if (pos < 0) return;
    if (value === node.textContent) return;
    const content = value ? node.type.schema.text(value) : null;
    const nextNode = node.type.create(node.attrs, content, node.marks);
    let tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, nextNode);
    if (preserveSourceSelection) {
      const offset = typeof srcEl.selectionStart === 'number'
        ? Math.max(0, Math.min(srcEl.selectionStart, value.length))
        : value.length;
      tr = tr.setSelection(TextSelection.create(tr.doc, Math.min(pos + 1 + offset, tr.doc.content.size)));
    }
    view.dispatch(tr);
  }

  function deleteNode() {
    const pos = nodePos();
    if (pos < 0) return;
    let tr = view.state.tr.delete(pos, pos + node.nodeSize);
    const selection = Selection.findFrom(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), 1, true) ||
      Selection.findFrom(tr.doc.resolve(Math.max(pos - 1, 0)), -1, true);
    if (selection) tr = tr.setSelection(selection);
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  srcEl.addEventListener('input', () => {
    currentSrc = srcEl.value;
    updateNode(srcEl.value, true);
  });
  sourceButton.addEventListener('mousedown', (event) => event.preventDefault());
  previewButton.addEventListener('mousedown', (event) => event.preventDefault());
  deleteButton.addEventListener('mousedown', (event) => event.preventDefault());
  sourceButton.addEventListener('click', (event) => {
    event.preventDefault();
    showSource();
  });
  previewButton.addEventListener('click', (event) => {
    event.preventDefault();
    showPreview();
    view.focus();
  });
  deleteButton.addEventListener('click', (event) => {
    event.preventDefault();
    deleteNode();
  });
  srcEl.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      showPreview();
      view.focus();
    }
  });

  const themeListener = () => {
    if (mermaidInstance) initializeMermaid(mermaidInstance);
    if (!isFocused) scheduleRender(node.textContent);
  };
  window.addEventListener('md-wysiwyg:theme-changed', themeListener);

  const pos = nodePos();
  const selection = view.state.selection;
  if (typeof pos === 'number' && selection.from > pos && selection.from < pos + node.nodeSize) {
    showSource();
  } else {
    showPreview();
  }

  return {
    dom: wrapper,
    update(newNode) {
      if (newNode.type.name !== node.type.name) return false;
      const newSrc = newNode.textContent;
      if (newSrc !== currentSrc) {
        currentSrc = newSrc;
        if (mode === 'source') {
          if (document.activeElement !== srcEl && srcEl.value !== newSrc) srcEl.value = newSrc;
        } else {
          scheduleRender(newSrc);
        }
      }
      node = newNode;
      return true;
    },
    selectNode() {
      showSource();
    },
    deselectNode() {
      if (mode === 'source') return;
      showPreview();
    },
    focus() {
      showSource();
    },
    stopEvent(event) {
      if (header.contains(event.target)) return true;
      return isFocused;
    },
    ignoreMutation() {
      return true;
    },
    destroy() {
      if (renderTimeout) clearTimeout(renderTimeout);
      window.removeEventListener('md-wysiwyg:theme-changed', themeListener);
    },
  };
}
