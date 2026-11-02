import { useSyncExternalStore } from 'react';
import { api, request, readSSE, ApiError } from '../api';
import { uid } from '../lib/util';
import { buildTree, deepest, pathTo, validLeaf } from '../lib/tree';
import { guessMime } from '../lib/files';

function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(fn) {
      state = typeof fn === 'function' ? fn(state) : fn;
      subs.forEach((s) => s());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.get);
}

// ---------- app (prefs, features, toasts) ----------

export const appStore = createStore({ prefs: null, features: null, session: null, toasts: [] });

export function toast(message, kind = 'info') {
  const id = uid();
  appStore.set((s) => ({ ...s, toasts: [...s.toasts, { id, message, kind }] }));
  setTimeout(() => appStore.set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), 3800);
}

export async function loadMe() {
  const me = await api.get('/api/me');
  appStore.set((s) => ({ ...s, prefs: me.prefs, features: me.features, session: me.session }));
  return me;
}

export async function savePrefs(patch) {
  const prev = appStore.get().prefs;
  appStore.set((s) => ({ ...s, prefs: { ...s.prefs, ...patch } }));
  try {
    const { prefs } = await api.put('/api/prefs', patch);
    appStore.set((s) => ({ ...s, prefs }));
  } catch (e) {
    appStore.set((s) => ({ ...s, prefs: prev }));
    toast(e.message || 'Couldn’t save settings.', 'error');
  }
}

// ---------- chat list ----------

export const listStore = createStore({ chats: [], loaded: false });

export async function loadChats() {
  const { chats } = await api.get('/api/chats');
  listStore.set((s) => {
    // Keep chats that exist only here so far (first reply still streaming) and titles being generated.
    const onServer = new Set(chats.map((c) => c.id));
    const prev = new Map(s.chats.map((c) => [c.id, c]));
    const pending = s.chats.filter((c) => !onServer.has(c.id) && chatStores.get(c.id)?.get().streaming);
    const merged = chats.map((c) => (prev.get(c.id)?.titling ? { ...c, title: prev.get(c.id).title, titling: true } : c));
    return { chats: [...pending, ...merged], loaded: true };
  });
}

function touchChat(id, patch, create) {
  listStore.set((s) => {
    let chats = s.chats;
    const i = chats.findIndex((c) => c.id === id);
    if (i === -1) {
      if (!create) return s;
      chats = [{ id, pinned: 0, title: 'New chat', created_at: Date.now(), updated_at: Date.now(), ...create, ...patch }, ...chats];
    } else chats = chats.map((c) => (c.id === id ? { ...c, ...patch } : c));
    if (patch.updated_at) chats = [...chats].sort((a, b) => b.updated_at - a.updated_at);
    return { ...s, chats };
  });
}

export async function renameChat(id, title) {
  touchChat(id, { title });
  await api.patch(`/api/chats/${id}`, { title }).catch((e) => toast(e.message, 'error'));
}

export async function pinChat(id, pinned) {
  touchChat(id, { pinned: pinned ? 1 : 0 });
  await api.patch(`/api/chats/${id}`, { pinned }).catch((e) => toast(e.message, 'error'));
}

export async function deleteChat(id) {
  chatStores.get(id)?.get().streaming?.controller.abort();
  listStore.set((s) => ({ ...s, chats: s.chats.filter((c) => c.id !== id) }));
  chatStores.delete(id);
  await api.del(`/api/chats/${id}`).catch((e) => toast(e.message, 'error'));
}

export async function deleteAllChats() {
  for (const st of chatStores.values()) st.get().streaming?.controller.abort();
  await api.del('/api/chats');
  chatStores.clear();
  listStore.set((s) => ({ ...s, chats: [] }));
}

// ---------- chats ----------

const chatStores = new Map();
const EMPTY = { msgs: {}, leaf: null, loaded: false, error: null, streaming: null };

export function chatStore(id) {
  if (!chatStores.has(id)) chatStores.set(id, createStore({ ...EMPTY }));
  return chatStores.get(id);
}

export const isStreaming = (id) => !!chatStores.get(id)?.get().streaming;

export async function openChat(id) {
  const st = chatStore(id);
  try {
    const d = await api.get(`/api/chats/${id}`);
    st.set((s) => {
      if (s.streaming) return s;
      // Keep anything this tab has that the server doesn't (e.g. a reply still being saved).
      const msgs = { ...Object.fromEntries(d.messages.map((m) => [m.id, m])), ...s.msgs };
      const leaf = s.leaf && msgs[s.leaf] ? s.leaf : validLeaf(msgs, d.chat.leaf_id);
      return { ...s, msgs, leaf, loaded: true, error: null };
    });
    touchChat(id, { title: d.chat.title, pinned: d.chat.pinned });
  } catch (e) {
    st.set((s) => ({ ...s, loaded: true, error: e.status === 404 ? 'missing' : e.message }));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function saveMessage(chatId, m) {
  const { local, ...data } = m;
  const names = (m.attachments || []).map((a) => a.name).join(' ');
  const body = { chat_id: chatId, parent_id: m.parentId, role: m.role, text: [m.text, names].filter(Boolean).join('\n'), data };
  for (let i = 0; i < 3; i++) {
    try {
      await api.put(`/api/messages/${m.id}`, body);
      return;
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 429) {
        toast(e.message || 'Couldn’t save this message.', 'error');
        return;
      }
      if (i === 2) toast('Couldn’t save this message. Check your connection.', 'error');
      else await sleep(1000 * (i + 1));
    }
  }
}

function toInput(path, code) {
  const out = [];
  for (const m of path) {
    if (m.role === 'user') {
      const content = [{ type: 'input_text', text: m.text || (m.attachments?.length ? 'Please look at the attached file(s).' : ' ') }];
      for (const a of m.attachments || []) {
        if (!a.id) continue;
        if (a.kind === 'image') content.push({ type: 'input_image', file_id: a.id });
        else if (a.kind === 'file') content.push({ type: 'input_file', file_id: a.id });
        else content.push({ type: 'input_text', text: `[Attached file "${a.name}". This type can’t be read directly${code ? ', but it is available to the python tool in /mnt/data' : ''}.]` });
      }
      out.push({ role: 'user', content });
    } else if (m.text) {
      out.push({ role: 'assistant', content: m.text });
    }
  }
  return out;
}

function fileIds(path) {
  const ids = [];
  for (const m of path) {
    for (const a of m.attachments || []) if (a.id) ids.push(a.id);
    for (const f of m.files || []) if (f.id) ids.push(f.id);
  }
  return [...new Set(ids)];
}

function friendly(msg) {
  if (!msg) return 'Something went wrong. Please try again.';
  if (/content (management|filter)|ResponsibleAIPolicyViolation/i.test(msg)) return 'That was blocked by the content filter. Try rephrasing it.';
  return msg;
}

const stepOf = (d, id) => d.steps.find((s) => s.id === id);

function addAnnotation(d, an) {
  if (an.type === 'url_citation' && an.url) {
    if (!d.citations.some((c) => c.url === an.url)) d.citations.push({ url: an.url, title: an.title || '' });
  } else if (an.type === 'container_file_citation' && an.file_id) {
    d.pending ||= [];
    if (!d.pending.some((f) => f.file_id === an.file_id)) d.pending.push({ container_id: an.container_id, file_id: an.file_id, filename: an.filename });
  }
}

function apply(d, ev, phase, t0) {
  switch (ev.type) {
    case 'response.output_item.added': {
      const it = ev.item;
      if (it.type === 'reasoning') d.steps.push({ type: 'reasoning', id: it.id, text: '', status: 'running' });
      else if (it.type === 'web_search_call') d.steps.push({ type: 'search', id: it.id, status: 'running', queries: [] });
      else if (it.type === 'code_interpreter_call') d.steps.push({ type: 'code', id: it.id, status: 'running', code: it.code || '', logs: '' });
      else if (it.type === 'message') {
        phase[it.id] = it.phase || 'final_answer';
        if (phase[it.id] === 'commentary') d.steps.push({ type: 'note', id: it.id, text: '', status: 'running' });
        else {
          if (d.thinkingMs == null) d.thinkingMs = Date.now() - t0;
          if (d.text && !d.text.endsWith('\n\n')) d.text += '\n\n';
        }
      }
      break;
    }
    case 'response.reasoning_summary_part.added': {
      const s = stepOf(d, ev.item_id);
      if (s && s.text) s.text += '\n\n';
      break;
    }
    case 'response.reasoning_summary_text.delta': {
      const s = stepOf(d, ev.item_id);
      if (s) s.text += ev.delta;
      break;
    }
    case 'response.output_text.delta': {
      if (phase[ev.item_id] === 'commentary') {
        const s = stepOf(d, ev.item_id);
        if (s) s.text += ev.delta;
      } else d.text += ev.delta;
      break;
    }
    case 'response.output_text.annotation.added':
      addAnnotation(d, ev.annotation || {});
      break;
    case 'response.code_interpreter_call_code.delta': {
      const s = stepOf(d, ev.item_id);
      if (s) s.code += ev.delta;
      break;
    }
    case 'response.code_interpreter_call_code.done': {
      const s = stepOf(d, ev.item_id);
      if (s) s.code = ev.code;
      break;
    }
    case 'response.output_item.done': {
      const it = ev.item;
      const s = stepOf(d, it.id);
      if (!s) break;
      s.status = 'done';
      if (it.type === 'web_search_call') {
        const a = it.action || {};
        s.action = a.type;
        s.queries = a.queries?.length ? a.queries : a.query ? [a.query] : [];
        if (a.url) s.url = a.url;
      } else if (it.type === 'code_interpreter_call') {
        s.code = it.code || s.code;
        const outs = it.outputs || [];
        s.logs = outs.filter((o) => o.type === 'logs').map((o) => o.logs).join('\n').slice(0, 20_000);
        s.images = outs.filter((o) => o.type === 'image' && /^data:image\//.test(o.url || '')).map((o) => o.url).slice(0, 4);
      }
      break;
    }
    case 'response.completed':
    case 'response.incomplete': {
      const r = ev.response || {};
      d.usage = r.usage;
      d.status = 'done';
      if (ev.type === 'response.incomplete') {
        const why = r.incomplete_details?.reason;
        d.notice = why === 'max_output_tokens' ? 'This answer hit the length limit.' : why === 'content_filter' ? 'Part of this answer was blocked by the content filter.' : 'This answer was cut short.';
      }
      const finals = (r.output || []).filter((o) => o.type === 'message' && (o.phase || 'final_answer') !== 'commentary');
      const text = finals.map((o) => (o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('')).join('\n\n');
      if (text) d.text = text;
      for (const o of finals) for (const c of o.content || []) for (const an of c.annotations || []) addAnnotation(d, an);
      break;
    }
    case 'response.failed':
      d.status = 'error';
      d.error = friendly(ev.response?.error?.message);
      break;
    case 'error':
      d.status = 'error';
      d.error = friendly(ev.message || ev.error?.message);
      break;
  }
}

const snapshot = (d) => ({ ...d, steps: d.steps.map((s) => ({ ...s })), citations: [...d.citations], files: [...d.files] });

async function runAssistant(chatId, parentId, { mode, web, code, userSaved }) {
  const st = chatStore(chatId);
  const controller = new AbortController();
  const d = { id: uid(), role: 'assistant', parentId, createdAt: Date.now(), mode, status: 'streaming', text: '', steps: [], citations: [], files: [] };
  st.set((s) => ({ ...s, msgs: { ...s.msgs, [d.id]: snapshot(d) }, leaf: d.id, streaming: { id: d.id, controller } }));

  let frame = 0;
  const flush = () => {
    frame = 0;
    st.set((s) => ({ ...s, msgs: { ...s.msgs, [d.id]: snapshot(d) } }));
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(flush);
  };

  const path = pathTo(st.get().msgs, parentId);
  const t0 = Date.now();
  const phase = {};
  try {
    const res = await request('/api/respond', {
      method: 'POST',
      raw: true,
      signal: controller.signal,
      body: { input: toInput(path, code), mode, web, code, file_ids: fileIds(path), tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
    for await (const ev of readSSE(res)) {
      apply(d, ev, phase, t0);
      schedule();
    }
    if (d.status === 'streaming') {
      d.status = 'error';
      d.error = 'The connection dropped before the answer finished.';
    }
  } catch (e) {
    if (e.name === 'AbortError') d.status = 'stopped';
    else {
      d.status = 'error';
      d.error = e instanceof ApiError ? friendly(e.message) : 'The connection dropped before the answer finished.';
      d.errorCode = e.code;
    }
  }
  if (frame) cancelAnimationFrame(frame);
  for (const s of d.steps) if (s.status === 'running') s.status = d.status === 'done' ? 'done' : 'stopped';
  if (d.thinkingMs == null && d.steps.length) d.thinkingMs = Date.now() - t0;

  const hasContent = !!(d.text || d.steps.length);
  if (!hasContent && d.status !== 'error') {
    // Stopped before anything arrived: drop the empty reply.
    st.set((s) => {
      const { [d.id]: _, ...msgs } = s.msgs;
      return { ...s, msgs, leaf: parentId, streaming: null };
    });
    return;
  }
  if (!hasContent) d.local = true; // error with nothing to keep: shown here, not saved
  flush();

  if (d.pending?.length) {
    d.saving = true;
    flush();
    let figures = 0;
    for (const p of d.pending) {
      // Auto-captured plots are named after their container file id; give them a readable name.
      const filename = /^cfile_/.test(p.filename) ? `figure-${++figures}${p.filename.slice(p.filename.lastIndexOf('.'))}` : p.filename;
      try {
        const r = await api.post('/api/container-file', { ...p, filename, chat_id: chatId });
        d.files.push({ id: r.id, name: r.name, bytes: r.bytes, mime: guessMime(r.name), cfile: p.file_id, path: `/mnt/data/${p.filename}` });
      } catch {
        d.files.push({ name: p.filename, cfile: p.file_id, path: `/mnt/data/${p.filename}`, expired: true });
      }
    }
    delete d.pending;
    delete d.saving;
  }
  st.set((s) => ({ ...s, msgs: { ...s.msgs, [d.id]: snapshot(d) }, streaming: null }));

  // Skip saving if the chat was deleted mid-answer (saving would recreate it).
  if (!d.local && chatStores.get(chatId) === st) {
    await userSaved;
    await saveMessage(chatId, snapshot(d));
    touchChat(chatId, { updated_at: Date.now() });
    maybeTitle(chatId, path);
  }
}

async function maybeTitle(chatId, path) {
  const chat = listStore.get().chats.find((c) => c.id === chatId);
  if (!chat || chat.title !== 'New chat' || chat.titling) return;
  touchChat(chatId, { titling: true });
  const first = path.find((m) => m.role === 'user');
  const names = (first?.attachments || []).map((a) => a.name).join(', ');
  const text = [first?.text, names && `[Attached: ${names}]`].filter(Boolean).join('\n');
  try {
    const { title } = await api.post('/api/title', { chat_id: chatId, text });
    touchChat(chatId, title ? { title, titling: false } : { titling: false });
  } catch {
    touchChat(chatId, { titling: false });
  }
}

// parentId undefined = continue from the visible branch (dropping an unsaved error reply at its end).
export function sendMessage(chatId, { text, attachments = [], parentId, mode, web, code }) {
  const st = chatStore(chatId);
  if (parentId === undefined) {
    const { msgs, leaf } = st.get();
    const end = msgs[leaf];
    parentId = end?.local ? end.parentId : leaf ?? null;
    if (end?.local) {
      st.set((s) => {
        const { [end.id]: _, ...rest } = s.msgs;
        return { ...s, msgs: rest };
      });
    }
  }
  const user = { id: uid(), role: 'user', parentId, createdAt: Date.now(), text, attachments };
  st.set((s) => ({ ...s, loaded: true, error: null, msgs: { ...s.msgs, [user.id]: user }, leaf: user.id }));
  touchChat(chatId, { updated_at: Date.now() }, {});
  const userSaved = saveMessage(chatId, user);
  return runAssistant(chatId, user.id, { mode, web, code, userSaved });
}

export function editMessage(chatId, userId, text, opts) {
  const old = chatStore(chatId).get().msgs[userId];
  return sendMessage(chatId, { ...opts, text, attachments: old.attachments || [], parentId: old.parentId });
}

export function regenerate(chatId, assistantId, opts) {
  const st = chatStore(chatId);
  const m = st.get().msgs[assistantId];
  if (!m) return;
  if (m.local) {
    st.set((s) => {
      const { [assistantId]: _, ...msgs } = s.msgs;
      return { ...s, msgs, leaf: m.parentId };
    });
  }
  return runAssistant(chatId, m.parentId, { ...opts, userSaved: Promise.resolve() });
}

export function replyTo(chatId, userId, opts) {
  return runAssistant(chatId, userId, { ...opts, userSaved: Promise.resolve() });
}

export function stop(chatId) {
  chatStores.get(chatId)?.get().streaming?.controller.abort();
}

export function switchBranch(chatId, msgId, dir) {
  const st = chatStore(chatId);
  const { msgs } = st.get();
  const children = buildTree(msgs);
  const sibs = children.get(msgs[msgId].parentId || 'root') || [];
  const target = sibs[sibs.indexOf(msgId) + dir];
  if (!target) return;
  const leaf = deepest(children, target);
  st.set((s) => ({ ...s, leaf }));
  if (!msgs[leaf].local) api.patch(`/api/chats/${chatId}`, { leaf_id: leaf }).catch(() => {});
}
