import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

function isTaskListItem(node) {
  return node.type.name === 'list_item' && typeof node.attrs.checked === 'boolean';
}

function createCheckbox(node, view, listItemPos) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'md-wysiwyg-task-checkbox';
  input.checked = node.attrs.checked;
  input.setAttribute('aria-label', node.attrs.checked ? 'Mark task incomplete' : 'Mark task complete');

  input.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  input.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const currentNode = view.state.doc.nodeAt(listItemPos);
    if (!currentNode || !isTaskListItem(currentNode)) return;

    const attrs = {
      ...currentNode.attrs,
      checked: !currentNode.attrs.checked,
    };
    view.dispatch(
      view.state.tr
        .setNodeMarkup(listItemPos, currentNode.type, attrs, currentNode.marks)
        .scrollIntoView()
    );
    view.focus();
  });

  return input;
}

export const taskListInteractionPlugin = $prose(() => {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations = [];

        state.doc.descendants((node, pos) => {
          if (!isTaskListItem(node)) return true;
          decorations.push(Decoration.widget(
            pos + 1,
            (view) => createCheckbox(node, view, pos),
            {
              key: 'task-checkbox-' + pos + '-' + node.attrs.checked,
              side: -1,
              stopEvent: () => true,
            }
          ));
          return true;
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
});
