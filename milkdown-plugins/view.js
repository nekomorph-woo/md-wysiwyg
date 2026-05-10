import { NodeType } from '@milkdown/kit/prose/model';
import { SchemaReady, nodeViewCtx, markViewCtx } from '@milkdown/core';

// Patched $view: upstream $nodeSchema copies nodeSchema.id before the lazy
// handler sets it, so type.id is always undefined at runtime.
// This version uses type.type(ctx).name which resolves after SchemaReady.
export function $view(type, view) {
  const plugin = (ctx) => async () => {
    await ctx.wait(SchemaReady);
    const v = view(ctx);
    if (type.type(ctx) instanceof NodeType) {
      ctx.update(nodeViewCtx, (ps) => [...ps, [type.type(ctx).name, v]]);
    } else {
      ctx.update(markViewCtx, (ps) => [...ps, [type.type(ctx).name, v]]);
    }
    return () => {
      if (type.type(ctx) instanceof NodeType) {
        ctx.update(nodeViewCtx, (ps) => ps.filter((x) => x[0] !== type.type(ctx).name));
      } else {
        ctx.update(markViewCtx, (ps) => ps.filter((x) => x[0] !== type.type(ctx).name));
      }
    };
  };
  return plugin;
}
