import { TextSelection } from '@milkdown/kit/prose/state';

const MARK_COMMANDS = {
  strong: 'strong',
  emphasis: 'emphasis',
  inlineCode: 'inlineCode',
};

const LANGUAGE_OPTIONS = [
  '', 'javascript', 'typescript', 'python', 'bash', 'json', 'yaml',
  'css', 'xml', 'markdown', 'sql', 'go', 'rust', 'java', 'cpp',
  'mermaid', 'plaintext',
];

const MERMAID_TEMPLATE = 'flowchart TD\n  A[Start] --> B[End]';

function textFromSelection(state) {
  const { selection } = state;
  if (selection.empty) {
    const text = selection.$from.parent && selection.$from.parent.isTextblock
      ? selection.$from.parent.textContent
      : '';
    return text || '';
  }
  return state.doc.textBetween(selection.from, selection.to, '\n', '\n');
}

function nearestTextblockRange(selection) {
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.isTextblock) {
      return {
        from: $from.before(depth),
        to: $from.after(depth),
        node,
      };
    }
  }
  return null;
}

function dispatchAndFocus(view, tr) {
  try {
    view.dispatch(tr.scrollIntoView());
    view.focus();
    return true;
  } catch (err) {
    console.warn('md-wysiwyg: editor command failed', err);
    return false;
  }
}

function markIsActive(state, markType) {
  const { selection } = state;
  if (selection.empty) {
    return Boolean(markType.isInSet(selection.$from.marks()));
  }
  return state.doc.rangeHasMark(selection.from, selection.to, markType);
}

function toggleMark(view, markName, attrs = null) {
  const markType = view.state.schema.marks[markName];
  if (!markType) return false;

  const { state } = view;
  const { selection } = state;
  const active = markIsActive(state, markType);
  let tr = state.tr;

  if (selection.empty) {
    if (active) tr = tr.removeStoredMark(markType);
    else tr = tr.addStoredMark(markType.create(attrs));
    return dispatchAndFocus(view, tr);
  }

  if (active) tr = tr.removeMark(selection.from, selection.to, markType);
  else tr = tr.addMark(selection.from, selection.to, markType.create(attrs));
  return dispatchAndFocus(view, tr);
}

function setTextblock(view, nodeName, attrs = null) {
  const nodeType = view.state.schema.nodes[nodeName];
  if (!nodeType) return false;
  const { state } = view;
  const tr = state.tr.setBlockType(state.selection.from, state.selection.to, nodeType, attrs);
  if (!tr.docChanged) return false;
  return dispatchAndFocus(view, tr);
}

function textNode(schema, text) {
  return text ? schema.text(text) : null;
}

function paragraphNode(schema, text) {
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return null;
  return paragraph.create(null, textNode(schema, text || ''));
}

function replaceCurrentTextblock(view, node, selectInside = false) {
  const range = nearestTextblockRange(view.state.selection);
  if (!range) return false;
  let tr = view.state.tr.replaceWith(range.from, range.to, node);
  if (selectInside && node.isTextblock) {
    const pos = Math.min(range.from + 1, tr.doc.content.size);
    tr = tr.setSelection(TextSelection.create(tr.doc, pos));
  }
  return dispatchAndFocus(view, tr);
}

function createListNode(schema, ordered, checked, text) {
  const listType = ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list;
  const listItem = schema.nodes.list_item;
  if (!listType || !listItem) return null;

  const paragraph = paragraphNode(schema, text || 'List item');
  if (!paragraph) return null;

  const itemAttrs = {
    label: ordered ? '1.' : '-',
    listType: ordered ? 'ordered' : 'bullet',
    spread: false,
  };
  if (typeof checked === 'boolean') itemAttrs.checked = checked;

  const item = listItem.createAndFill(itemAttrs, paragraph);
  if (!item) return null;

  const listAttrs = ordered ? { order: 1, spread: false } : { spread: false };
  return listType.createAndFill(listAttrs, item);
}

function insertList(view, kind) {
  const schema = view.state.schema;
  const currentText = textFromSelection(view.state);
  const ordered = kind === 'orderedList';
  const checked = kind === 'taskList' ? false : null;
  const list = createListNode(schema, ordered, checked, currentText);
  if (!list) return false;
  return replaceCurrentTextblock(view, list);
}

function insertBlockquote(view) {
  const schema = view.state.schema;
  const blockquote = schema.nodes.blockquote;
  if (!blockquote) return false;
  const paragraph = paragraphNode(schema, textFromSelection(view.state) || 'Quote');
  if (!paragraph) return false;
  return replaceCurrentTextblock(view, blockquote.createAndFill(null, paragraph));
}

function insertCodeBlock(view, language = '') {
  const schema = view.state.schema;
  const codeBlock = schema.nodes.code_block;
  if (!codeBlock) return false;
  let text = textFromSelection(view.state);
  if (!text && language === 'mermaid') text = MERMAID_TEMPLATE;
  const node = codeBlock.create({ language }, textNode(schema, text));
  return replaceCurrentTextblock(view, node, language === 'mermaid');
}

function insertHorizontalRule(view) {
  const horizontalRule = view.state.schema.nodes.hr ||
    view.state.schema.nodes.horizontal_rule ||
    view.state.schema.nodes.thematic_break;
  if (!horizontalRule) return false;
  return dispatchAndFocus(view, view.state.tr.replaceSelectionWith(horizontalRule.create()));
}

function findMarkRange(state, markName) {
  const markType = state.schema.marks[markName];
  if (!markType) return null;
  const { selection } = state;
  const $pos = selection.$from;
  const parent = $pos.parent;
  const parentStart = $pos.start();
  let start = null;
  let end = null;
  let foundMark = null;

  parent.forEach((child, offset) => {
    if (!child.isText) return;
    const mark = markType.isInSet(child.marks);
    if (!mark) return;
    const from = parentStart + offset;
    const to = from + child.nodeSize;
    const touchesSelection = selection.empty
      ? from <= selection.from && selection.from <= to
      : to >= selection.from && from <= selection.to;
    if (!touchesSelection) return;
    if (start == null || from < start) start = from;
    if (end == null || to > end) end = to;
    foundMark = mark;
  });

  if (start == null || end == null || !foundMark) return null;
  return { from: start, to: end, mark: foundMark };
}

function setLink(view, attrs) {
  const href = attrs && attrs.href ? String(attrs.href).trim() : '';
  if (!href) return removeLink(view);

  const linkType = view.state.schema.marks.link;
  if (!linkType) return false;
  const title = attrs.title ? String(attrs.title) : null;
  const { state } = view;
  const { selection } = state;

  if (selection.empty) {
    const existing = findMarkRange(state, 'link');
    if (existing) {
      const mark = linkType.create({ href, title });
      const tr = state.tr
        .removeMark(existing.from, existing.to, existing.mark)
        .addMark(existing.from, existing.to, mark);
      return dispatchAndFocus(view, tr);
    }

    const label = attrs.text || href;
    const node = state.schema.text(label, [linkType.create({ href, title })]);
    return dispatchAndFocus(view, state.tr.replaceSelectionWith(node));
  }

  const tr = state.tr.addMark(selection.from, selection.to, linkType.create({ href, title }));
  return dispatchAndFocus(view, tr);
}

function removeLink(view) {
  const linkType = view.state.schema.marks.link;
  if (!linkType) return false;
  const { state } = view;
  const { selection } = state;
  const range = selection.empty ? findMarkRange(state, 'link') : null;
  const from = range ? range.from : selection.from;
  const to = range ? range.to : selection.to;
  if (from === to) return false;
  return dispatchAndFocus(view, state.tr.removeMark(from, to, linkType));
}

function updateCodeBlockLanguageAtSelection(view, language) {
  const { state } = view;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== 'code_block') continue;
    const pos = depth === 0 ? 0 : $from.before(depth);
    const attrs = { ...node.attrs, language };
    let tr = state.tr.setNodeMarkup(pos, node.type, attrs, node.marks);
    if (language === 'mermaid') {
      tr = tr.setSelection(TextSelection.create(tr.doc, Math.min(pos + 1, tr.doc.content.size)));
    }
    return dispatchAndFocus(view, tr);
  }
  return insertCodeBlock(view, language);
}

function insertPlainText(view, text) {
  const value = String(text || '');
  if (!value) return false;
  return dispatchAndFocus(view, view.state.tr.insertText(value));
}

function deleteSelection(view) {
  if (!view || view.state.selection.empty) return false;
  return dispatchAndFocus(view, view.state.tr.deleteSelection());
}

export function selectedPlainText(view) {
  if (!view) return '';
  const { state } = view;
  const { selection } = state;
  if (!selection.empty) return state.doc.textBetween(selection.from, selection.to, '\n', '\n');

  const domSelection = typeof window !== 'undefined' ? window.getSelection() : null;
  return domSelection ? String(domSelection.toString() || '') : '';
}

export function runEditorCommand(view, command, payload = {}) {
  if (!view) return false;

  if (MARK_COMMANDS[command]) return toggleMark(view, MARK_COMMANDS[command]);

  if (command === 'paragraph') return setTextblock(view, 'paragraph');
  if (command === 'heading') return setTextblock(view, 'heading', { level: payload.level || 1 });
  if (command === 'bulletList' || command === 'orderedList' || command === 'taskList') {
    return insertList(view, command);
  }
  if (command === 'blockquote') return insertBlockquote(view);
  if (command === 'codeBlock') return insertCodeBlock(view, payload.language || '');
  if (command === 'mermaid') return insertCodeBlock(view, 'mermaid');
  if (command === 'horizontalRule') return insertHorizontalRule(view);
  if (command === 'setLink') return setLink(view, payload);
  if (command === 'removeLink') return removeLink(view);
  if (command === 'codeLanguage') return updateCodeBlockLanguageAtSelection(view, payload.language || '');
  if (command === 'insertText') return insertPlainText(view, payload.text || '');
  if (command === 'deleteSelection') return deleteSelection(view);

  return false;
}

export function getEditorStateInfo(view) {
  if (!view) return {};
  const { state } = view;
  const marks = {};
  for (const markName of Object.values(MARK_COMMANDS)) {
    const markType = state.schema.marks[markName];
    marks[markName] = markType ? markIsActive(state, markType) : false;
  }

  const $from = state.selection.$from;
  let block = { name: $from.parent.type.name, attrs: $from.parent.attrs };
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'code_block') {
      block = { name: 'code_block', attrs: node.attrs };
      break;
    }
  }

  const link = getLinkAtSelection(view);
  return { marks, block, link };
}

export function getLinkAtSelection(view) {
  if (!view) return null;
  const range = findMarkRange(view.state, 'link');
  if (!range) return null;
  return {
    from: range.from,
    to: range.to,
    href: range.mark.attrs.href || '',
    title: range.mark.attrs.title || '',
    text: view.state.doc.textBetween(range.from, range.to, '', ''),
  };
}

export { LANGUAGE_OPTIONS };
