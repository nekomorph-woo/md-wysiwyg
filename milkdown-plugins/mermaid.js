let mermaidInstance = null;

export function loadMermaid() {
  if (mermaidInstance) return Promise.resolve(mermaidInstance);
  return new Promise((resolve, reject) => {
    try {
      const mod = require('./mermaid-bundle.cjs');
      mermaidInstance = mod.default || mod;
      const themeAttr = document.documentElement.getAttribute('data-theme');
      const theme = themeAttr === 'light' ? 'default' : 'dark';
      mermaidInstance.initialize({
        startOnLoad: false,
        theme: theme,
        securityLevel: 'loose',
      });
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

  const wrapper = document.createElement('div');
  wrapper.classList.add('mermaid-wrapper');

  const preview = document.createElement('div');
  preview.classList.add('mermaid-preview');
  wrapper.appendChild(preview);

  const srcEl = document.createElement('pre');
  srcEl.classList.add('mermaid-source');
  wrapper.appendChild(srcEl);

  let isFocused = false;

  function showSource() {
    isFocused = true;
    srcEl.style.display = '';
    preview.style.display = 'none';
    const text = node.textContent;
    srcEl.textContent = text;
    currentSrc = text;
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
    renderTimeout = setTimeout(() => renderDiagram(src), delay);
  }

  async function renderDiagram(src) {
    if (!src.trim()) {
      preview.innerHTML = '<span class="mermaid-placeholder">Mermaid diagram</span>';
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
      preview.innerHTML = svg;
    } catch (err) {
      console.error('md-wysiwyg: mermaid render error', err);
      const orphan = document.getElementById('d' + id);
      if (orphan) orphan.remove();
      preview.innerHTML = '<span class="mermaid-error">Mermaid error: ' + (err.message || err) + '</span>';
    }
  }

  showPreview();

  return {
    dom: wrapper,
    update(newNode) {
      if (newNode.type.name !== node.type.name) return false;
      const newSrc = newNode.textContent;
      if (newSrc !== currentSrc) {
        currentSrc = newSrc;
        if (isFocused) {
          srcEl.textContent = newSrc;
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
    },
  };
}
