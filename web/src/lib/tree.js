// Chats are trees: editing a message or regenerating a reply adds a sibling branch.

export function buildTree(msgs) {
  const children = new Map();
  for (const m of Object.values(msgs)) {
    const k = m.parentId || 'root';
    if (!children.has(k)) children.set(k, []);
    children.get(k).push(m.id);
  }
  for (const ids of children.values()) ids.sort((a, b) => msgs[a].createdAt - msgs[b].createdAt);
  return children;
}

export function pathTo(msgs, leafId) {
  const out = [];
  const seen = new Set();
  let cur = msgs[leafId];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? msgs[cur.parentId] : null;
  }
  return out.reverse();
}

export function deepest(children, id) {
  let cur = id;
  for (;;) {
    const kids = children.get(cur);
    if (!kids?.length) return cur;
    cur = kids[kids.length - 1];
  }
}

export function validLeaf(msgs, leaf) {
  if (leaf && msgs[leaf]) return deepest(buildTree(msgs), leaf);
  const all = Object.values(msgs);
  if (!all.length) return null;
  return all.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).id;
}
