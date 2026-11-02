import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Search, SquarePen } from 'lucide-react';
import { Modal } from './ui';
import { api } from '../api';
import { listStore, useStore } from '../state/store';
import { ago } from '../lib/util';

// Snippets come from raw markdown; drop the syntax so they read as plain sentences.
const clean = (s) =>
  s
    .replace(/\$\$?/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\|?\s*:?-{3,}:?\s*/g, ' ')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/(\s·)+/g, ' ·')
    .replace(/\s+/g, ' ')
    .trim();

function Highlight({ text, term }) {
  if (!term) return text;
  const lower = text.toLowerCase();
  const out = [];
  let i = 0;
  for (;;) {
    const j = lower.indexOf(term, i);
    if (j === -1) break;
    out.push(text.slice(i, j), <mark key={j}>{text.slice(j, j + term.length)}</mark>);
    i = j + term.length;
  }
  out.push(text.slice(i));
  return out;
}

export default function SearchModal({ open, onClose, onPick, onNew }) {
  const { chats } = useStore(listStore);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const list = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setRemote(null);
    setSel(0);
  }, [open]);

  const term = q.trim().toLowerCase();

  useEffect(() => {
    if (!term) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get(`/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => setRemote({ term, results: r.results }))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [term]);

  const items = useMemo(() => {
    if (!term) return chats.slice(0, 15).map((c) => ({ id: c.id, title: c.title, snippet: '', ts: c.updated_at }));
    const server = remote?.term === term ? remote.results.map((r) => ({ id: r.chat_id, title: r.title, snippet: clean(r.snippet), ts: r.updated_at })) : [];
    const seen = new Set(server.map((s) => s.id));
    const local = chats.filter((c) => !seen.has(c.id) && c.title.toLowerCase().includes(term)).map((c) => ({ id: c.id, title: c.title, snippet: '', ts: c.updated_at }));
    return [...server, ...local];
  }, [term, chats, remote]);

  useEffect(() => setSel(0), [term]);
  useEffect(() => {
    list.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter' && items[sel]) {
      e.preventDefault();
      onPick(items[sel].id);
    }
  };

  return (
    <Modal open={open} onClose={onClose} label="Search chats" className="search-modal">
      <div className="search-input">
        <Search size={18} />
        <input autoFocus placeholder="Search chats…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        {loading && <span className="mini-spin" />}
        <kbd>Esc</kbd>
      </div>
      <div className="search-results" ref={list}>
        <button type="button" className="search-row new" onClick={onNew}>
          <SquarePen size={17} />
          <span className="sr-main">
            <span className="sr-title">New chat</span>
          </span>
        </button>
        <div className="search-label">{term ? 'Results' : 'Recent'}</div>
        {items.map((it, i) => (
          <button key={it.id} type="button" className={`search-row ${i === sel ? 'sel' : ''}`} onMouseMove={() => setSel(i)} onClick={() => onPick(it.id)}>
            <MessageSquare size={17} />
            <span className="sr-main">
              <span className="sr-title">
                <Highlight text={it.title} term={term} />
              </span>
              {it.snippet && (
                <span className="sr-snippet">
                  <Highlight text={it.snippet} term={term} />
                </span>
              )}
            </span>
            <span className="sr-time">{ago(it.ts)}</span>
          </button>
        ))}
        {term && !items.length && !loading && <p className="search-empty">No chats match “{q.trim()}”.</p>}
        {!term && !items.length && <p className="search-empty">No chats yet.</p>}
      </div>
    </Modal>
  );
}
