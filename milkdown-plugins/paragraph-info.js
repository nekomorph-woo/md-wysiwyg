import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

// --- Source Expansion: editable markdown source on focus ---

const sourceExpansionKey = new PluginKey('source-expansion');

const MARK_INFO = {
  strong: { open: '**', close: '**' },
  emphasis: { open: '*', close: '*' },
  inlineCode: { open: '`', close: '`' },
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeDelimRegex(open, close) {
  return new RegExp(
    '^\\s*' + escapeRegex(open) + '([\\s\\S]*?)' + escapeRegex(close) + '\\s*$'
  );
}

function extractWs(text) {
  const m = text.match(/^(\s*)/);
  const n = text.match(/(\s*)$/);
  return { before: m ? m[1] : '', after: n ? n[1] : '' };
}

function collapseTr(state, from, to, innerText, markType, markAttrs) {
  const tr = state.tr;
  const parts = [];
  const full = state.doc.textBetween(from, to, '', '');
  const { before, after } = extractWs(full);
  if (before) parts.push(state.schema.text(before));
  parts.push(state.schema.text(innerText, [markType.create(markAttrs)]));
  if (after) parts.push(state.schema.text(after));
  tr.replaceWith(from, to, parts);
  tr.setMeta(sourceExpansionKey, 'collapse');
  tr.setMeta('addToHistory', false);
  return tr;
}

function cleanupTr(state) {
  return state.tr.setMeta(sourceExpansionKey, 'cleanup').setMeta('addToHistory', false);
}

function findMarkRange(doc, pos, mark) {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const idx = $pos.index();
  const textOff = $pos.textOffset;
  let start = pos - textOff;
  let end = start;
  for (let i = idx; i < parent.childCount; i++) {
    const child = parent.child(i);
    if (child.isText && mark.isInSet(child.marks)) {
      end += child.nodeSize;
    } else {
      break;
    }
  }
  for (let i = idx - 1; i >= 0; i--) {
    const child = parent.child(i);
    if (child.isText && mark.isInSet(child.marks)) {
      start -= child.nodeSize;
    } else {
      break;
    }
  }
  return { from: start, to: end };
}

function expand(state, mark, range, info) {
  const { from, to } = range;
  const tr = state.tr;
  tr.removeMark(from, to, mark);
  tr.insertText(info.open, from);
  tr.insertText(info.close, to + info.open.length);
  tr.setMeta(sourceExpansionKey, {
    action: 'expand',
    markName: mark.type.name,
    from: from,
    to: to + info.open.length + info.close.length,
  });
  tr.setMeta('addToHistory', false);
  return tr;
}

function collapse(state, expandedState) {
  const { from, to, markName } = expandedState;

  const info = MARK_INFO[markName];
  if (!info) return cleanupTr(state);

  const fullText = state.doc.textBetween(from, to, '', '');
  if (fullText.trim().length === 0) return cleanupTr(state);

  const regex = makeDelimRegex(info.open, info.close);
  const match = fullText.match(regex);

  if (match && match[1].length > 0) {
    const markType = state.schema.marks[markName];
    if (markType) return collapseTr(state, from, to, match[1], markType);
  }

  return parseAndCollapse(state, from, to, fullText);
}

export function getDocWithCollapsedSource(view) {
  const expandedState = sourceExpansionKey.getState(view.state);
  if (!expandedState || !expandedState.expanded) return view.state.doc;

  const tr = collapse(view.state, expandedState);
  if (!tr) return view.state.doc;

  return tr.doc;
}

function parseAndCollapse(state, from, to, fullText) {
  if (fullText.trim().length === 0) return cleanupTr(state);

  for (const [name, info] of Object.entries(MARK_INFO)) {
    const regex = makeDelimRegex(info.open, info.close);
    const match = fullText.match(regex);
    if (match && match[1].length > 0) {
      const markType = state.schema.marks[name];
      if (markType) return collapseTr(state, from, to, match[1], markType);
    }
  }

  return cleanupTr(state);
}

export const sourceExpansionPlugin = $prose(() => {
  return new Plugin({
    key: sourceExpansionKey,
    state: {
      init() {
        return { expanded: false, markName: null, from: -1, to: -1 };
      },
      apply(tr, value) {
        const meta = tr.getMeta(sourceExpansionKey);
        if (meta) {
          if (meta && meta.action === 'expand') {
            return { expanded: true, markName: meta.markName, from: meta.from, to: meta.to };
          }
          return { expanded: false, markName: null, from: -1, to: -1 };
        }
        if (value.expanded) {
          const newFrom = tr.mapping.map(value.from);
          const newTo = tr.mapping.map(value.to);
          return { expanded: true, markName: value.markName, from: newFrom, to: newTo };
        }
        return value;
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      for (const tr of transactions) {
        if (tr.getMeta(sourceExpansionKey)) return null;
      }

      const state = sourceExpansionKey.getState(newState);
      const pos = newState.selection.from;

      if (newState.selection.from !== newState.selection.to) return null;

      const docChanged = transactions.some(tr => tr.docChanged);

      if (state.expanded) {
        let from = state.from;
        let to = state.to;
        for (const tr of transactions) {
          from = tr.mapping.map(from);
          to = tr.mapping.map(to);
        }
        if (pos >= from && pos <= to) return null;
        return collapse(newState, { ...state, from, to });
      }

      if (docChanged) return null;
      if (!transactions.some(tr => tr.selectionSet)) return null;

      const $pos = newState.doc.resolve(pos);
      const marks = $pos.marks();

      // Check delimiter-based marks
      const mark = marks.find(m => MARK_INFO[m.type.name]);
      if (!mark) return null;

      const range = findMarkRange(newState.doc, pos, mark);
      if (range.from >= range.to) return null;

      return expand(newState, mark, range, MARK_INFO[mark.type.name]);
    },
  });
});
