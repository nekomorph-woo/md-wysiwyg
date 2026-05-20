import { NodeSelection, Selection, TextSelection } from '@milkdown/kit/prose/state';

const MARK_COMMANDS = {
  strong: 'strong',
  emphasis: 'emphasis',
  inlineCode: 'inlineCode',
};

const LANGUAGE_OPTIONS = [
  '', 'javascript', 'typescript', 'python', 'bash', 'json', 'yaml',
  'css', 'xml', 'markdown', 'sql', 'go', 'rust', 'java', 'cpp',
  'mermaid', 'frontmatter', 'plaintext',
];

const MERMAID_TEMPLATE = 'flowchart TD\n  A[Start] --> B[End]';
const MATH_TEMPLATE = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';

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
  } else if (selectInside) {
    const selection = Selection.findFrom(tr.doc.resolve(Math.min(range.from + 1, tr.doc.content.size)), 1, true);
    if (selection) tr = tr.setSelection(selection);
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

function insertCallout(view, payload = {}) {
  const schema = view.state.schema;
  const blockquote = schema.nodes.blockquote;
  if (!blockquote) return false;

  const type = String(payload.type || 'NOTE').toUpperCase();
  const title = payload.title ? ' ' + String(payload.title) : '';
  const label = paragraphNode(schema, '[!' + type + ']' + title);
  const body = paragraphNode(schema, textFromSelection(view.state) || 'Callout text');
  if (!label || !body) return false;

  return replaceCurrentTextblock(view, blockquote.create(null, [label, body]), true);
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

function createTableCell(schema, header, alignment = 'left', text = '') {
  const type = header ? schema.nodes.table_header : schema.nodes.table_cell;
  const paragraph = paragraphNode(schema, text);
  if (!type || !paragraph) return null;
  return type.createAndFill({ alignment }, paragraph);
}

function createTableNode(schema, rows = 3, cols = 3) {
  const table = schema.nodes.table;
  const headerRow = schema.nodes.table_header_row;
  const tableRow = schema.nodes.table_row;
  if (!table || !headerRow || !tableRow) return null;

  const safeRows = Math.max(2, rows);
  const safeCols = Math.max(1, cols);
  const headerCells = Array.from({ length: safeCols }, (_, index) =>
    createTableCell(schema, true, 'left', index === 0 ? 'Header' : 'Column ' + (index + 1))
  );
  const bodyRows = Array.from({ length: safeRows - 1 }, () => {
    const cells = Array.from({ length: safeCols }, () => createTableCell(schema, false, 'left', ''));
    return tableRow.create(null, cells);
  });

  return table.create(null, [headerRow.create(null, headerCells), ...bodyRows]);
}

function findTableContext(state) {
  const { $from } = state.selection;
  let tableDepth = -1;
  let rowDepth = -1;
  let cellDepth = -1;

  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (cellDepth < 0 && (name === 'table_cell' || name === 'table_header')) cellDepth = depth;
    if (rowDepth < 0 && (name === 'table_row' || name === 'table_header_row')) rowDepth = depth;
    if (tableDepth < 0 && name === 'table') tableDepth = depth;
  }

  if (tableDepth < 0 || rowDepth < 0 || cellDepth < 0) return null;

  return {
    table: $from.node(tableDepth),
    tablePos: $from.before(tableDepth),
    rowIndex: $from.index(tableDepth),
    colIndex: $from.index(rowDepth),
  };
}

function replaceTable(view, context, rows) {
  const nextTable = context.table.type.create(context.table.attrs, rows);
  const tr = view.state.tr.replaceWith(
    context.tablePos,
    context.tablePos + context.table.nodeSize,
    nextTable
  );
  const selection = Selection.findFrom(tr.doc.resolve(Math.min(context.tablePos + 1, tr.doc.content.size)), 1, true);
  if (selection) tr.setSelection(selection);
  return dispatchAndFocus(view, tr);
}

function deleteTable(view) {
  const context = findTableContext(view.state);
  if (!context) return false;
  const paragraph = view.state.schema.nodes.paragraph;
  if (!paragraph) return false;

  let tr = view.state.tr.replaceWith(
    context.tablePos,
    context.tablePos + context.table.nodeSize,
    paragraph.create()
  );
  tr = tr.setSelection(TextSelection.create(tr.doc, Math.min(context.tablePos + 1, tr.doc.content.size)));
  return dispatchAndFocus(view, tr);
}

function insertTable(view, payload = {}) {
  const rows = Number(payload.rows || 3);
  const cols = Number(payload.cols || 3);
  const table = createTableNode(view.state.schema, rows, cols);
  if (!table) return false;
  return replaceCurrentTextblock(view, table, true);
}

function addTableRow(view, after = true) {
  const context = findTableContext(view.state);
  if (!context) return false;
  const schema = view.state.schema;
  const rowType = schema.nodes.table_row;
  const width = context.table.firstChild ? context.table.firstChild.childCount : 1;
  const cells = Array.from({ length: width }, (_, col) => {
    const headerCell = context.table.firstChild && context.table.firstChild.child(col);
    return createTableCell(schema, false, headerCell ? headerCell.attrs.alignment : 'left', '');
  });
  const newRow = rowType.create(null, cells);
  const rows = [];
  context.table.forEach((row, _offset, index) => {
    if (after && index === context.rowIndex) rows.push(row, newRow);
    else if (!after && index === context.rowIndex) rows.push(newRow, row);
    else rows.push(row);
  });
  return replaceTable(view, context, rows);
}

function deleteTableRow(view) {
  const context = findTableContext(view.state);
  if (!context || context.rowIndex === 0 || context.table.childCount <= 2) return false;
  const rows = [];
  context.table.forEach((row, _offset, index) => {
    if (index !== context.rowIndex) rows.push(row);
  });
  return replaceTable(view, context, rows);
}

function addTableColumn(view, after = true) {
  const context = findTableContext(view.state);
  if (!context) return false;
  const schema = view.state.schema;
  const rows = [];
  context.table.forEach((row, _offset, rowIndex) => {
    const cells = [];
    row.forEach((cell, _cellOffset, colIndex) => {
      const insert = () => cells.push(createTableCell(schema, rowIndex === 0, cell.attrs.alignment, ''));
      if (!after && colIndex === context.colIndex) insert();
      cells.push(cell);
      if (after && colIndex === context.colIndex) insert();
    });
    rows.push(row.type.create(row.attrs, cells));
  });
  return replaceTable(view, context, rows);
}

function deleteTableColumn(view) {
  const context = findTableContext(view.state);
  if (!context || context.table.firstChild.childCount <= 1) return false;
  const rows = [];
  context.table.forEach((row) => {
    const cells = [];
    row.forEach((cell, _cellOffset, colIndex) => {
      if (colIndex !== context.colIndex) cells.push(cell);
    });
    rows.push(row.type.create(row.attrs, cells));
  });
  return replaceTable(view, context, rows);
}

function setTableColumnAlign(view, alignment = 'left') {
  const context = findTableContext(view.state);
  if (!context) return false;
  const rows = [];
  context.table.forEach((row) => {
    const cells = [];
    row.forEach((cell, _cellOffset, colIndex) => {
      const attrs = colIndex === context.colIndex ? { ...cell.attrs, alignment } : cell.attrs;
      cells.push(cell.type.create(attrs, cell.content, cell.marks));
    });
    rows.push(row.type.create(row.attrs, cells));
  });
  return replaceTable(view, context, rows);
}

function moveTableCell(view, direction) {
  const context = findTableContext(view.state);
  if (!context) return false;
  const width = context.table.firstChild ? context.table.firstChild.childCount : 0;
  const height = context.table.childCount;
  if (!width || !height) return false;
  let row = context.rowIndex;
  let col = context.colIndex + direction;
  if (col >= width) {
    row += 1;
    col = 0;
  } else if (col < 0) {
    row -= 1;
    col = width - 1;
  }
  if (row < 0 || row >= height) return false;

  let pos = context.tablePos + 1;
  for (let r = 0; r < row; r++) pos += context.table.child(r).nodeSize;
  pos += 1;
  const targetRow = context.table.child(row);
  for (let c = 0; c < col; c++) pos += targetRow.child(c).nodeSize;
  const selection = Selection.findFrom(view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size)), 1, true);
  if (!selection) return false;
  const tr = view.state.tr.setSelection(selection);
  return dispatchAndFocus(view, tr);
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

function safeRange(state, range) {
  if (!range || typeof range.from !== 'number' || typeof range.to !== 'number') return null;
  const from = Math.max(0, Math.min(range.from, state.doc.content.size));
  const to = Math.max(from, Math.min(range.to, state.doc.content.size));
  return from < to ? { from, to } : null;
}

function setLink(view, attrs) {
  const href = attrs && attrs.href ? String(attrs.href).trim() : '';
  if (!href) return removeLink(view, attrs);

  const linkType = view.state.schema.marks.link;
  if (!linkType) return false;
  const title = attrs.title ? String(attrs.title) : null;
  const { state } = view;
  const { selection } = state;
  const explicitRange = safeRange(state, attrs.range);
  const text = attrs.text ? String(attrs.text) : '';
  const linkMark = linkType.create({ href, title });

  if (explicitRange) {
    const currentText = state.doc.textBetween(explicitRange.from, explicitRange.to, '', '');
    if (text && text !== currentText) {
      const node = state.schema.text(text, [linkMark]);
      return dispatchAndFocus(view, state.tr.replaceWith(explicitRange.from, explicitRange.to, node));
    }
    return dispatchAndFocus(
      view,
      state.tr
        .removeMark(explicitRange.from, explicitRange.to, linkType)
        .addMark(explicitRange.from, explicitRange.to, linkMark)
    );
  }

  if (selection.empty) {
    const existing = findMarkRange(state, 'link');
    if (existing) {
      if (text && text !== state.doc.textBetween(existing.from, existing.to, '', '')) {
        const node = state.schema.text(text, [linkMark]);
        return dispatchAndFocus(view, state.tr.replaceWith(existing.from, existing.to, node));
      }
      const tr = state.tr
        .removeMark(existing.from, existing.to, existing.mark)
        .addMark(existing.from, existing.to, linkMark);
      return dispatchAndFocus(view, tr);
    }

    const label = text || href;
    const node = state.schema.text(label, [linkMark]);
    return dispatchAndFocus(view, state.tr.replaceSelectionWith(node));
  }

  const tr = state.tr.addMark(selection.from, selection.to, linkMark);
  return dispatchAndFocus(view, tr);
}

function removeLink(view, attrs = {}) {
  const linkType = view.state.schema.marks.link;
  if (!linkType) return false;
  const { state } = view;
  const { selection } = state;
  const explicitRange = safeRange(state, attrs.range);
  if (explicitRange) {
    return dispatchAndFocus(view, state.tr.removeMark(explicitRange.from, explicitRange.to, linkType));
  }
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

function insertImage(view, attrs = {}) {
  const image = view.state.schema.nodes.image;
  if (!image) return false;
  const selectedText = textFromSelection(view.state);
  const node = image.create({
    src: attrs.src || '',
    alt: attrs.alt || selectedText || '',
    title: attrs.title || '',
  });
  const { from } = view.state.selection;
  let tr = view.state.tr.replaceSelectionWith(node);
  if (attrs.select !== false) {
    tr = tr.setSelection(NodeSelection.create(tr.doc, Math.min(from, tr.doc.content.size)));
  }
  return dispatchAndFocus(view, tr);
}

function insertMath(view, block = false) {
  const type = block ? view.state.schema.nodes.math_block : view.state.schema.nodes.math_inline;
  if (!type) return false;
  const selectedText = textFromSelection(view.state);
  const value = selectedText || MATH_TEMPLATE;
  const node = type.create({ value }, textNode(view.state.schema, value));
  if (block) return replaceCurrentTextblock(view, node, true);
  return dispatchAndFocus(view, view.state.tr.replaceSelectionWith(node));
}

function nextFootnoteLabel(doc) {
  const labels = new Set();
  doc.descendants((node) => {
    if (
      (node.type.name === 'footnote_reference' || node.type.name === 'footnote_definition') &&
      node.attrs.label
    ) {
      labels.add(node.attrs.label);
    }
    return true;
  });

  let index = 1;
  while (labels.has('fn-' + index)) index++;
  return 'fn-' + index;
}

function insertFootnote(view) {
  const schema = view.state.schema;
  const referenceType = schema.nodes.footnote_reference;
  const definitionType = schema.nodes.footnote_definition;
  const paragraph = schema.nodes.paragraph;
  if (!referenceType || !definitionType || !paragraph) return false;

  const label = nextFootnoteLabel(view.state.doc);
  const reference = referenceType.create({ label });
  const definitionText = textNode(schema, 'Footnote text');
  const definition = definitionType.create({ label }, paragraph.create(null, definitionText));
  const insertFrom = view.state.selection.from;
  let tr = view.state.tr.replaceSelectionWith(reference);
  tr = tr.insert(tr.doc.content.size, definition);
  tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(insertFrom + reference.nodeSize, tr.doc.content.size)), 1));
  return dispatchAndFocus(view, tr);
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
  if (command === 'callout') return insertCallout(view, payload);
  if (command === 'codeBlock') return insertCodeBlock(view, payload.language || '');
  if (command === 'mermaid') return insertCodeBlock(view, 'mermaid');
  if (command === 'horizontalRule') return insertHorizontalRule(view);
  if (command === 'table') return insertTable(view, payload);
  if (command === 'addTableRowBefore') return addTableRow(view, false);
  if (command === 'addTableRowAfter') return addTableRow(view, true);
  if (command === 'deleteTableRow') return deleteTableRow(view);
  if (command === 'addTableColumnBefore') return addTableColumn(view, false);
  if (command === 'addTableColumnAfter') return addTableColumn(view, true);
  if (command === 'deleteTableColumn') return deleteTableColumn(view);
  if (command === 'deleteTable') return deleteTable(view);
  if (command === 'tableAlign') return setTableColumnAlign(view, payload.alignment || 'left');
  if (command === 'nextTableCell') return moveTableCell(view, 1);
  if (command === 'previousTableCell') return moveTableCell(view, -1);
  if (command === 'setLink') return setLink(view, payload);
  if (command === 'removeLink') return removeLink(view, payload);
  if (command === 'codeLanguage') return updateCodeBlockLanguageAtSelection(view, payload.language || '');
  if (command === 'insertText') return insertPlainText(view, payload.text || '');
  if (command === 'insertImage') return insertImage(view, payload);
  if (command === 'mathInline') return insertMath(view, false);
  if (command === 'mathBlock') return insertMath(view, true);
  if (command === 'footnote') return insertFootnote(view);
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
  const table = findTableContext(state);
  return { marks, block, link, table };
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
