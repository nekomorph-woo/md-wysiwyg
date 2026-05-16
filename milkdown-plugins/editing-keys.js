import { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

function hasModifier(event) {
  return event.metaKey || event.ctrlKey || event.altKey;
}

function deleteSelectionOrAdjacent(view, direction) {
  const { state } = view;
  const { selection } = state;

  if (!selection.empty) {
    view.dispatch(state.tr.deleteSelection().scrollIntoView());
    return true;
  }

  if (direction < 0) {
    if (selection.from <= 1) return false;
    view.dispatch(state.tr.delete(selection.from - 1, selection.from).scrollIntoView());
    return true;
  }

  if (selection.to >= state.doc.content.size) return false;
  view.dispatch(state.tr.delete(selection.to, selection.to + 1).scrollIntoView());
  return true;
}

export const editingKeysPlugin = $prose(() => {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
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
