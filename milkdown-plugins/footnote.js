import { footnoteDefinitionSchema, footnoteReferenceSchema } from '@milkdown/kit/preset/gfm';
import { Selection } from '@milkdown/kit/prose/state';
import { $view } from './view';

function findFootnotes(doc, label) {
  const result = {
    definition: null,
    references: [],
  };

  doc.descendants((node, pos) => {
    if (node.type.name === 'footnote_definition' && node.attrs.label === label) {
      result.definition = { node, pos };
      return false;
    }
    if (node.type.name === 'footnote_reference' && node.attrs.label === label) {
      result.references.push({ node, pos });
      return false;
    }
    return true;
  });

  return result;
}

function jumpToPos(view, pos) {
  try {
    const selection = Selection.near(view.state.doc.resolve(Math.min(pos, view.state.doc.content.size)), 1);
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    view.focus();
  } catch (err) {
    console.warn('md-wysiwyg: failed to jump to footnote', err);
  }
}

function summarizeDefinition(definition) {
  if (!definition || !definition.node) return 'No matching footnote definition.';
  const text = definition.node.textContent.trim();
  if (!text) return 'Empty footnote definition.';
  return text.length > 120 ? text.slice(0, 117) + '...' : text;
}

function createFootnoteReferenceView() {
  return (node, view) => {
    const dom = document.createElement('sup');
    dom.className = 'md-wysiwyg-footnote-ref';
    dom.contentEditable = 'false';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'md-wysiwyg-footnote-ref-button';
    button.textContent = node.attrs.label || '?';
    dom.appendChild(button);

    const popover = document.createElement('span');
    popover.className = 'md-wysiwyg-footnote-popover';
    popover.style.display = 'none';
    dom.appendChild(popover);

    const summary = document.createElement('span');
    summary.className = 'md-wysiwyg-footnote-summary';
    popover.appendChild(summary);

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'btn md-wysiwyg-footnote-jump';
    jump.textContent = 'Jump';
    popover.appendChild(jump);

    function sync() {
      button.textContent = node.attrs.label || '?';
      summary.textContent = summarizeDefinition(findFootnotes(view.state.doc, node.attrs.label).definition);
    }

    function toggle() {
      sync();
      popover.style.display = popover.style.display === 'none' ? 'grid' : 'none';
    }

    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      toggle();
    });
    jump.addEventListener('mousedown', (event) => event.preventDefault());
    jump.addEventListener('click', (event) => {
      event.preventDefault();
      const footnotes = findFootnotes(view.state.doc, node.attrs.label);
      if (footnotes.definition) jumpToPos(view, footnotes.definition.pos + 1);
      popover.style.display = 'none';
    });

    sync();

    return {
      dom,
      update(newNode) {
        if (newNode.type.name !== node.type.name) return false;
        node = newNode;
        sync();
        return true;
      },
      deselectNode() {
        popover.style.display = 'none';
      },
      stopEvent(event) {
        return dom.contains(event.target);
      },
      ignoreMutation() {
        return true;
      },
    };
  };
}

function createFootnoteDefinitionView() {
  return (node, view) => {
    const dom = document.createElement('div');
    dom.className = 'md-wysiwyg-footnote-def';

    const header = document.createElement('div');
    header.className = 'md-wysiwyg-footnote-def-header';
    header.contentEditable = 'false';
    dom.appendChild(header);

    const label = document.createElement('span');
    label.className = 'md-wysiwyg-footnote-def-label';
    header.appendChild(label);

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn md-wysiwyg-footnote-back';
    back.textContent = 'Back';
    header.appendChild(back);

    const content = document.createElement('div');
    content.className = 'md-wysiwyg-footnote-def-content';
    dom.appendChild(content);

    function sync() {
      label.textContent = 'Footnote [' + (node.attrs.label || '?') + ']';
    }

    back.addEventListener('mousedown', (event) => event.preventDefault());
    back.addEventListener('click', (event) => {
      event.preventDefault();
      const footnotes = findFootnotes(view.state.doc, node.attrs.label);
      const firstRef = footnotes.references[0];
      if (firstRef) jumpToPos(view, firstRef.pos);
    });

    sync();

    return {
      dom,
      contentDOM: content,
      update(newNode) {
        if (newNode.type.name !== node.type.name) return false;
        node = newNode;
        sync();
        return true;
      },
      stopEvent(event) {
        return header.contains(event.target);
      },
    };
  };
}

export const footnoteReferenceView = $view(footnoteReferenceSchema, createFootnoteReferenceView);
export const footnoteDefinitionView = $view(footnoteDefinitionSchema, createFootnoteDefinitionView);
export const footnotePlugin = [footnoteReferenceView, footnoteDefinitionView];
