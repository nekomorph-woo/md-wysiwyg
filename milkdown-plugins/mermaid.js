let mermaidInstance = null;

function currentTheme() {
  const themeAttr = document.documentElement.getAttribute('data-theme');
  return themeAttr === 'light' ? 'default' : 'dark';
}

function initializeMermaid(mermaid) {
  mermaid.initialize({
    startOnLoad: false,
    theme: currentTheme(),
    securityLevel: 'loose',
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

  const preview = document.createElement('div');
  preview.classList.add('mermaid-preview');
  wrapper.appendChild(preview);

  const srcEl = document.createElement('textarea');
  srcEl.classList.add('mermaid-source');
  srcEl.spellcheck = false;
  wrapper.appendChild(srcEl);

  let isFocused = false;

  function showSource() {
    isFocused = true;
    srcEl.style.display = '';
    preview.style.display = 'none';
    const text = node.textContent;
    srcEl.value = text;
    currentSrc = text;
    setTimeout(() => srcEl.focus(), 0);
  }

  function showPreview() {
    isFocused = false;
    srcEl.style.display = 'none';
    preview.style.display = '';
    currentSrc = node.textContent;
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
      placeholder.textContent = 'Mermaid diagram';
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
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const content = value ? node.type.schema.text(value) : null;
    const nextNode = node.type.create(node.attrs, content, node.marks);
    view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, nextNode));
  }

  srcEl.addEventListener('input', () => updateNode(srcEl.value));
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

  showPreview();

  return {
    dom: wrapper,
    update(newNode) {
      if (newNode.type.name !== node.type.name) return false;
      const newSrc = newNode.textContent;
      if (newSrc !== currentSrc) {
        currentSrc = newSrc;
        if (isFocused) {
          if (srcEl.value !== newSrc) srcEl.value = newSrc;
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
    stopEvent() {
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
