import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { NodeSelection, Plugin, Selection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { $view } from './view';

const path = require('path');
const imageAssets = require('../lib/image-assets');

function editorFilePath(view) {
  const host = view.dom.closest('.md-wysiwyg-editor');
  return host ? host.getAttribute('data-file-path') : '';
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

function imageUrlFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return '';
  const uri = dataTransfer.getData && dataTransfer.getData('text/uri-list');
  if (uri && /^https?:\/\//i.test(uri.trim())) return uri.trim().split(/\r?\n/)[0];
  const text = dataTransfer.getData && dataTransfer.getData('text/plain');
  if (text && /^https?:\/\/\S+$/i.test(text.trim())) return text.trim();
  return '';
}

async function downloadImageUrl(url, docPath) {
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not download image: HTTP ' + response.status);
  const type = response.headers.get('content-type') || '';
  if (!imageAssets.isImageFile(url, type)) return null;
  const arrayBuffer = await response.arrayBuffer();
  const ext = path.extname(new URL(url).pathname) || (type.includes('png') ? '.png' : '.jpg');
  return imageAssets.localizeImageFile({
    name: 'remote-image' + ext,
    type,
    arrayBuffer: () => Promise.resolve(arrayBuffer),
  }, docPath);
}

function handleImageFiles(view, event) {
  const docPath = editorFilePath(view);
  if (!docPath) return false;

  const files = filesFromDataTransfer(event.clipboardData || event.dataTransfer)
    .filter((file) => imageAssets.isImageFile(file.path || file.name, file.type));
  const imageUrl = imageUrlFromDataTransfer(event.clipboardData || event.dataTransfer);
  if (files.length === 0 && !imageUrl) return false;

  event.preventDefault();

  const filePromises = files.map((file) => imageAssets.localizeImageFile(file, docPath));
  const urlPromise = files.length === 0 && imageUrl ? downloadImageUrl(imageUrl, docPath) : null;

  Promise.all(urlPromise ? [...filePromises, urlPromise] : filePromises).then((images) => {
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
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn';
    deleteButton.textContent = 'Delete';
    deleteButton.title = 'Delete image';

    form.appendChild(srcInput);
    form.appendChild(altInput);
    form.appendChild(titleInput);
    form.appendChild(apply);
    form.appendChild(deleteButton);

    function sync() {
      img.src = imageAssets.previewUrlForSrc(node.attrs.src || '', editorFilePath(view));
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

    function selectImage() {
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (typeof pos !== 'number') return;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    }

    function deleteImage() {
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (typeof pos !== 'number') return;
      let tr = view.state.tr.delete(pos, pos + node.nodeSize);
      const selection = Selection.findFrom(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), 1, true) ||
        Selection.findFrom(tr.doc.resolve(Math.max(pos - 1, 0)), -1, true);
      if (selection) tr = tr.setSelection(selection);
      view.dispatch(tr.scrollIntoView());
      view.focus();
    }

    wrapper.addEventListener('click', (event) => {
      event.preventDefault();
      selectImage();
      showEditor();
    });
    form.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });
    form.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    apply.addEventListener('mousedown', (event) => event.preventDefault());
    deleteButton.addEventListener('mousedown', (event) => event.preventDefault());
    apply.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      update({
        src: srcInput.value.trim(),
        alt: altInput.value,
        title: titleInput.value,
      });
      hideEditor();
    });
    deleteButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      deleteImage();
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
