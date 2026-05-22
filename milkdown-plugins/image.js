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

function setDropSelection(view, event) {
  if (!event || typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return;
  const drop = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!drop || typeof drop.pos !== 'number') return;
  const pos = Math.max(0, Math.min(drop.pos, view.state.doc.content.size));
  view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos), 1)));
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

function hasImageDropPayload(dataTransfer) {
  if (!dataTransfer) return false;
  const files = Array.from(dataTransfer.files || []);
  if (files.some((file) => imageAssets.isImageFile(file.path || file.name, file.type))) return true;
  const items = Array.from(dataTransfer.items || []);
  if (items.some((item) => item.kind === 'file' && imageAssets.isImageFile('', item.type))) return true;
  if (imageUrlFromDataTransfer(dataTransfer)) return true;
  return Array.from(dataTransfer.types || []).includes('Files') && items.length === 0;
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

function stopNativeDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  if (event.stopImmediatePropagation) event.stopImmediatePropagation();
}

function handleImageFiles(view, event, options = {}) {
  const docPath = editorFilePath(view);
  if (!docPath) return false;

  const files = filesFromDataTransfer(event.clipboardData || event.dataTransfer)
    .filter((file) => imageAssets.isImageFile(file.path || file.name, file.type));
  const imageUrl = imageUrlFromDataTransfer(event.clipboardData || event.dataTransfer);
  if (files.length === 0 && !imageUrl) return false;

  stopNativeDrop(event);
  if (options.useDropPosition) setDropSelection(view, event);

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

function handleImageDragOver(event) {
  if (!hasImageDropPayload(event.dataTransfer)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
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
    form.className = 'md-wysiwyg-image-editor md-wysiwyg-floating-image-editor';
    form.style.display = 'none';
    form.style.position = 'fixed';
    form.style.zIndex = '1000';
    form.style.gridTemplateColumns = 'minmax(220px, 1fr) minmax(110px, 150px) minmax(110px, 150px) max-content max-content';
    form.style.width = 'min(680px, calc(100vw - 24px))';
    form.draggable = false;
    const editorHost = view.dom.closest('.md-wysiwyg-editor');
    (editorHost || document.body).appendChild(form);

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
    const refreshAssetPreview = () => sync();

    function disableNodeDrag() {
      wrapper.draggable = false;
      wrapper.removeAttribute('draggable');
      img.draggable = false;
      img.removeAttribute('draggable');
      form.draggable = false;
      form.removeAttribute('draggable');
    }

    function positionEditor() {
      if (form.style.display === 'none') return;
      const rect = img.getBoundingClientRect();
      const viewportPadding = 12;
      const maxLeft = Math.max(viewportPadding, window.innerWidth - form.offsetWidth - viewportPadding);
      const left = Math.min(Math.max(rect.left, viewportPadding), maxLeft);
      const below = rect.bottom + 8;
      const above = rect.top - form.offsetHeight - 8;
      let top = below + form.offsetHeight <= window.innerHeight - viewportPadding
        ? below
        : Math.max(viewportPadding, above);
      if (rect.bottom < viewportPadding || rect.top > window.innerHeight - viewportPadding) {
        top = Math.min(
          Math.max(viewportPadding, rect.top),
          Math.max(viewportPadding, window.innerHeight - form.offsetHeight - viewportPadding),
        );
      }
      form.style.left = left + 'px';
      form.style.top = top + 'px';
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
      disableNodeDrag();
      positionEditor();
      window.addEventListener('resize', positionEditor);
      window.addEventListener('scroll', positionEditor, true);
    }

    function hideEditor() {
      form.style.display = 'none';
      wrapper.classList.remove('selected');
      window.removeEventListener('resize', positionEditor);
      window.removeEventListener('scroll', positionEditor, true);
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
    wrapper.addEventListener('dragstart', (event) => {
      if (form.style.display === 'none') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }, true);
    const stopEditingEvent = (event) => {
      disableNodeDrag();
      event.stopPropagation();
    };
    const stopEditingDrag = (event) => {
      disableNodeDrag();
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    };
    ['mousedown', 'mouseup', 'mousemove', 'dblclick', 'selectstart'].forEach((eventName) => {
      form.addEventListener(eventName, stopEditingEvent);
    });
    form.addEventListener('click', stopEditingEvent);
    ['dragstart', 'dragover', 'drop'].forEach((eventName) => {
      form.addEventListener(eventName, stopEditingDrag, true);
      form.addEventListener(eventName, stopEditingDrag);
    });
    [srcInput, altInput, titleInput].forEach((input) => {
      input.draggable = false;
      input.addEventListener('mousedown', disableNodeDrag, true);
      input.addEventListener('focus', disableNodeDrag);
      input.addEventListener('dragstart', stopEditingDrag, true);
      input.addEventListener('dragstart', stopEditingDrag);
    });
    apply.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    deleteButton.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
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
    window.addEventListener('md-wysiwyg:assets-changed', refreshAssetPreview);

    sync();

    return {
      dom: wrapper,
      update(newNode) {
        if (newNode.type.name !== node.type.name) return false;
        node = newNode;
        sync();
        if (form.style.display !== 'none') disableNodeDrag();
        positionEditor();
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
      destroy() {
        window.removeEventListener('md-wysiwyg:assets-changed', refreshAssetPreview);
        window.removeEventListener('resize', positionEditor);
        window.removeEventListener('scroll', positionEditor, true);
        if (form.parentNode) form.parentNode.removeChild(form);
      },
      ignoreMutation() {
        return true;
      },
    };
  };
});

const imagePasteDropPlugin = $prose(() => {
  return new Plugin({
    view(view) {
      const host = view.dom.closest('.md-wysiwyg-editor') || view.dom;
      const insideEditor = (event) => view.dom.contains(event.target);
      const onDragOver = (event) => {
        if (!insideEditor(event)) return;
        handleImageDragOver(event);
      };
      const onDrop = (event) => {
        if (!insideEditor(event)) return;
        if (hasImageDropPayload(event.dataTransfer)) {
          handleImageFiles(view, event, { useDropPosition: true });
        }
      };
      host.addEventListener('dragenter', onDragOver, true);
      host.addEventListener('dragover', onDragOver, true);
      host.addEventListener('drop', onDrop, true);
      return {
        destroy() {
          host.removeEventListener('dragenter', onDragOver, true);
          host.removeEventListener('dragover', onDragOver, true);
          host.removeEventListener('drop', onDrop, true);
        },
      };
    },
    props: {
      handleDOMEvents: {
        dragover(_view, event) {
          return handleImageDragOver(event);
        },
      },
      handlePaste(view, event) {
        return handleImageFiles(view, event);
      },
      handleDrop(view, event) {
        return handleImageFiles(view, event, { useDropPosition: true });
      },
    },
  });
});

export const imageSupportPlugin = [imageNodeView, imagePasteDropPlugin];
