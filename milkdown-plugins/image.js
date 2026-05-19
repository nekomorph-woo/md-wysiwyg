import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { $view } from './view';

const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

function isImageFile(filePath, mimeType = '') {
  if (mimeType && mimeType.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(path.extname(filePath || '').toLowerCase());
}

function editorFilePath(view) {
  const host = view.dom.closest('.md-wysiwyg-editor');
  return host ? host.getAttribute('data-file-path') : '';
}

function uniqueTargetPath(dir, fileName) {
  const parsed = path.parse(fileName || 'image.png');
  const safeName = (parsed.name || 'image').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const ext = parsed.ext || '.png';
  let candidate = path.join(dir, safeName + ext);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, safeName + '-' + index + ext);
    index++;
  }
  return candidate;
}

async function copyImageToAssets(filePath, docPath) {
  const docDir = path.dirname(docPath);
  const assetsDir = path.join(docDir, 'assets');
  await fs.promises.mkdir(assetsDir, { recursive: true });
  const target = uniqueTargetPath(assetsDir, path.basename(filePath));
  await fs.promises.copyFile(filePath, target);
  return path.relative(docDir, target).split(path.sep).join('/');
}

function imageNode(schema, attrs) {
  const type = schema.nodes.image;
  if (!type) return null;
  return type.create({
    src: attrs.src || '',
    alt: attrs.alt || '',
    title: attrs.title || '',
  });
}

function insertImage(view, attrs) {
  const node = imageNode(view.state.schema, attrs);
  if (!node) return false;
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  view.focus();
  return true;
}

function filesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return [];
  const files = Array.from(dataTransfer.files || []);
  if (files.length > 0) return files;

  return Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function handleImageFiles(view, event) {
  const docPath = editorFilePath(view);
  if (!docPath) return false;

  const files = filesFromDataTransfer(event.clipboardData || event.dataTransfer)
    .filter((file) => isImageFile(file.path, file.type));
  if (files.length === 0) return false;

  event.preventDefault();

  Promise.all(files.map(async (file) => {
    if (!file.path) return null;
    const src = await copyImageToAssets(file.path, docPath);
    return { src, alt: path.basename(file.path, path.extname(file.path)), title: '' };
  })).then((images) => {
    images.filter(Boolean).forEach((attrs) => insertImage(view, attrs));
  }).catch((err) => {
    if (typeof atom !== 'undefined' && atom.notifications) {
      atom.notifications.addError('Failed to insert image', { detail: err.message });
    }
  });

  return true;
}

const imageNodeView = $view(imageSchema, () => {
  return (node, view, getPos) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'md-wysiwyg-image-node';
    wrapper.contentEditable = 'false';

    const img = document.createElement('img');
    wrapper.appendChild(img);

    const form = document.createElement('span');
    form.className = 'md-wysiwyg-image-editor';
    form.style.display = 'none';
    wrapper.appendChild(form);

    const srcInput = document.createElement('input');
    srcInput.className = 'input-text native-key-bindings';
    srcInput.placeholder = 'src';
    const altInput = document.createElement('input');
    altInput.className = 'input-text native-key-bindings';
    altInput.placeholder = 'alt';
    const titleInput = document.createElement('input');
    titleInput.className = 'input-text native-key-bindings';
    titleInput.placeholder = 'title';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'btn btn-primary';
    apply.textContent = 'Apply';

    form.appendChild(srcInput);
    form.appendChild(altInput);
    form.appendChild(titleInput);
    form.appendChild(apply);

    function sync() {
      img.src = node.attrs.src || '';
      img.alt = node.attrs.alt || '';
      img.title = node.attrs.title || '';
      srcInput.value = node.attrs.src || '';
      altInput.value = node.attrs.alt || '';
      titleInput.value = node.attrs.title || '';
    }

    function update(attrs) {
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (typeof pos !== 'number') return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, node.type, {
        ...node.attrs,
        ...attrs,
      }, node.marks).scrollIntoView());
      view.focus();
    }

    function showEditor() {
      form.style.display = 'grid';
      wrapper.classList.add('selected');
    }

    function hideEditor() {
      form.style.display = 'none';
      wrapper.classList.remove('selected');
    }

    wrapper.addEventListener('click', (event) => {
      event.preventDefault();
      showEditor();
    });
    apply.addEventListener('mousedown', (event) => event.preventDefault());
    apply.addEventListener('click', (event) => {
      event.preventDefault();
      update({
        src: srcInput.value.trim(),
        alt: altInput.value,
        title: titleInput.value,
      });
      hideEditor();
    });

    sync();

    return {
      dom: wrapper,
      update(newNode) {
        if (newNode.type.name !== node.type.name) return false;
        node = newNode;
        sync();
        return true;
      },
      selectNode() {
        showEditor();
      },
      deselectNode() {
        hideEditor();
      },
      stopEvent(event) {
        return form.contains(event.target) || event.target === img;
      },
      ignoreMutation() {
        return true;
      },
    };
  };
});

const imagePasteDropPlugin = $prose(() => {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        return handleImageFiles(view, event);
      },
      handleDrop(view, event) {
        return handleImageFiles(view, event);
      },
    },
  });
});

export const imageSupportPlugin = [imageNodeView, imagePasteDropPlugin];
