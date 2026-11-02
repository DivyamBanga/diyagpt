export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 22);

export const DAY = 86_400_000;

export function bytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
}

export function stamp(ts) {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function greeting(name) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Up late';
  return name ? `${part}, ${name}` : part;
}

export function groupChats(chats) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups = new Map();
  const add = (label, c) => {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(c);
  };
  for (const c of chats) {
    if (c.pinned) add('Pinned', c);
    else if (c.updated_at >= today) add('Today', c);
    else if (c.updated_at >= today - DAY) add('Yesterday', c);
    else if (c.updated_at >= today - 7 * DAY) add('Previous 7 days', c);
    else if (c.updated_at >= today - 30 * DAY) add('Previous 30 days', c);
    else add(new Date(c.updated_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), c);
  }
  return [...groups.entries()];
}

export const isTouch = () => window.matchMedia('(hover: none)').matches;

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function plainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' Code block. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\\\(|\\\)|\\\[|\\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
