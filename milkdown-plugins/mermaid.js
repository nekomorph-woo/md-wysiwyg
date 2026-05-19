let mermaidInstance = null;

function currentTheme() {
  const themeAttr = document.documentElement.getAttribute('data-theme');
  return themeAttr === 'light' ? 'default' : 'dark';
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

  function updateNode(value) {
    const pos = nodePos();
    if (pos < 0) return;
    if (value === node.textContent) return;
    const content = value ? node.type.schema.text(value) : null;
    const nextNode = node.type.create(node.attrs, content, node.marks);
    view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, nextNode));
  }

  srcEl.addEventListener('input', () => updateNode(srcEl.value));
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
        if (isFocused) {
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
      return false;
    },
    destroy() {
      if (renderTimeout) clearTimeout(renderTimeout);
      window.removeEventListener('md-wysiwyg:theme-changed', themeListener);
    },
  };
}
