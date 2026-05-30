import { hardbreakSchema } from '@milkdown/kit/preset/commonmark';
import { $view } from './view';

const hardbreakView = $view(hardbreakSchema, () => {
  return (node) => {
    const dom = document.createElement('br');
    dom.dataset.type = 'hardbreak';
    if (node.attrs.isInline) dom.dataset.isInline = 'true';

    return {
      dom,
      update(nextNode) {
        if (nextNode.type.name !== 'hardbreak') return false;
        if (nextNode.attrs.isInline) dom.dataset.isInline = 'true';
        else delete dom.dataset.isInline;
        return true;
      },
      ignoreMutation() {
        return true;
      },
    };
  };
});

export const lineBreakViewPlugin = hardbreakView;
