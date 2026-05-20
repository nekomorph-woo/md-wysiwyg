import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const CALLOUT_LABELS = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

function calloutInfo(node) {
  if (!node || !node.type || node.type.name !== 'blockquote' || node.childCount === 0) {
    return null;
  }

  const first = node.firstChild;
  if (!first || first.type.name !== 'paragraph') return null;

  const match = String(first.textContent || '').match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)\s*$/i);
  if (!match) return null;

  const type = match[1].toLowerCase();
  const title = match[2] ? match[2].trim() : '';
  const label = CALLOUT_LABELS[type] || type;

  return {
    type,
    label: title ? label + ': ' + title : label,
  };
}

export const calloutPlugin = $prose(() => {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations = [];

        state.doc.descendants((node, pos) => {
          const info = calloutInfo(node);
          if (!info) return true;
          decorations.push(Decoration.node(pos, pos + node.nodeSize, {
            class: 'md-wysiwyg-callout md-wysiwyg-callout-' + info.type,
            'data-callout-label': info.label,
          }));
          return false;
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
});
