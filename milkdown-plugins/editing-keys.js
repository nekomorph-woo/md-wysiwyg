import { Plugin, Selection, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { runEditorCommand } from './editor-commands';

function hasModifier(event) {
  return event.metaKey || event.ctrlKey || event.altKey;
}

function clipboardText(event) {
  const text = event.clipboardData && event.clipboardData.getData('text/plain');
  if (text) return text;
  if (typeof atom !== 'undefined' && atom.clipboard) return atom.clipboard.read();
  return '';
}

function insertClipboardText(view, event) {
  const text = clipboardText(event);
  if (!text) return false;
  event.preventDefault();
  view.dispatch(view.state.tr.insertText(text).scrollIntoView());
  view.focus();
  return true;
}

function emptyListItemToParagraph(view) {
  const { state } = view;
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  let listItemDepth = -1;

  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'list_item') {
      listItemDepth = depth;
      break;
    }
  }

  if (listItemDepth < 1) return false;

  const listItem = $from.node(listItemDepth);
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph || listItem.textContent.length > 0) return false;

  const listDepth = listItemDepth - 1;
  const listNode = $from.node(listDepth);
  if (!listNode || !/^(bullet_list|ordered_list)$/.test(listNode.type.name)) return false;
  if (listNode.childCount !== 1) return false;

  const listPos = $from.before(listDepth);
  view.dispatch(
    state.tr
      .replaceWith(listPos, listPos + listNode.nodeSize, paragraph.create())
      .scrollIntoView()
  );
  view.focus();
  return true;
}

function deleteSelectionOrAdjacent(view, direction) {
  const { state } = view;
  const { selection } = state;

  if (!selection.empty) {
    view.dispatch(state.tr.deleteSelection().scrollIntoView());
    return true;
  }

  if (emptyListItemToParagraph(view)) return true;

  if (direction < 0) {
    if (selection.from <= 1) return false;
    view.dispatch(state.tr.delete(selection.from - 1, selection.from).scrollIntoView());
    return true;
  }

  if (selection.to >= state.doc.content.size) return false;
  view.dispatch(state.tr.delete(selection.to, selection.to + 1).scrollIntoView());
  return true;
}

function slashCommandIsOpen() {
  const menu = typeof document !== 'undefined'
    ? document.querySelector('.md-wysiwyg-slash-menu')
    : null;
  if (!menu) return false;
  return menu.style.display !== 'none';
}

function moveCursorWithPlainArrow(view, event) {
  if (hasModifier(event) || event.shiftKey || slashCommandIsOpen()) return false;
  if (!/^Arrow(Left|Right|Up|Down)$/.test(event.key)) return false;

  const { state } = view;
  let selection = null;
  const { from, to, empty } = state.selection;

  if (event.key === 'ArrowLeft') {
    const pos = empty ? from - 1 : from;
    if (pos < 0) return false;
    selection = Selection.near(state.doc.resolve(pos), -1);
  } else if (event.key === 'ArrowRight') {
    const pos = empty ? to + 1 : to;
    if (pos > state.doc.content.size) return false;
    selection = Selection.near(state.doc.resolve(pos), 1);
  } else if (event.key === 'ArrowUp') {
    selection = selectionFromVerticalMovement(view, -1);
  } else if (event.key === 'ArrowDown') {
    selection = selectionFromVerticalMovement(view, 1);
  }

  if (!selection) return false;

  event.preventDefault();
  view.dispatch(state.tr.setSelection(selection).scrollIntoView());
  view.focus();
  return true;
}

function selectionFromVerticalMovement(view, direction) {
  const { state } = view;
  try {
    const coords = view.coordsAtPos(state.selection.head);
    const lineHeight = parseFloat(window.getComputedStyle(view.dom).lineHeight) || 20;
    const target = view.posAtCoords({
      left: coords.left,
      top: direction < 0 ? coords.top - lineHeight : coords.bottom + lineHeight,
    });
    if (target && typeof target.pos === 'number') {
      return Selection.near(state.doc.resolve(target.pos), direction);
    }
  } catch (_err) {
    return direction < 0 ? TextSelection.atStart(state.doc) : TextSelection.atEnd(state.doc);
  }
  return direction < 0 ? TextSelection.atStart(state.doc) : TextSelection.atEnd(state.doc);
}

export const editingKeysPlugin = $prose(() => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        paste(view, event) {
          return insertClipboardText(view, event);
        },
      },
      handlePaste(view, event) {
        return insertClipboardText(view, event);
      },
      handleKeyDown(view, event) {
        if (event.key === 'Tab') {
          const handled = runEditorCommand(
            view,
            event.shiftKey ? 'previousTableCell' : 'nextTableCell'
          );
          if (handled) event.preventDefault();
          return handled;
        }

        if (moveCursorWithPlainArrow(view, event)) return true;
        if (hasModifier(event)) return false;

        if (event.key === 'Backspace') {
          const handled = deleteSelectionOrAdjacent(view, -1);
          if (handled) event.preventDefault();
          return handled;
        }

        if (event.key === 'Delete') {
          const handled = deleteSelectionOrAdjacent(view, 1);
          if (handled) event.preventDefault();
          return handled;
        }

        return false;
      },
    },
  });
});
