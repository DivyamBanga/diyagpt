import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, CalendarDays, Ellipsis, Globe, ImagePlus, Lightbulb, Megaphone, PanelLeft, PauseCircle, Pencil, PenLine, Pin, PinOff, SquarePen, Trash2, Upload, X } from 'lucide-react';
import Composer from './Composer';
import Logo from './Logo';
import { AssistantMessage, UserMessage } from './Message';
import { IconBtn, Menu, MenuItem, confirmDialog, promptDialog } from './ui';
import {
  appStore, chatStore, deleteChat, editMessage, listStore, openChat, pinChat, regenerate, renameChat, replyTo, sendMessage,
  stop, switchBranch, useStore,
} from '../state/store';
import { buildTree, pathTo } from '../lib/tree';
import { greeting, uid } from '../lib/util';

const SUGGESTIONS = [
  { icon: PenLine, label: 'Help me write', prompt: 'Help me write ' },
  { icon: Lightbulb, label: 'Explain something', prompt: 'Explain like I’m curious but new to it: ' },
  { icon: CalendarDays, label: 'Plan my day', prompt: 'Help me plan my day. Here’s what I need to get done: ' },
  { icon: ImagePlus, label: 'Look at a photo or file', attach: true },
  { icon: Globe, label: 'What’s new today', prompt: 'What are the most interesting news stories today?', send: true },
];

function annKey(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `diyagpt.ann.${h}`;
}

function Announcement({ text }) {
  const key = annKey(text);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  return (
    <div className="banner announce">
      <Megaphone size={16} />
      <span>{text}</span>
      <IconBtn
        label="Dismiss"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(key, '1');
          } catch {}
        }}
      >
        <X size={15} />
      </IconBtn>
    </div>
  );
}

function ChatTitle({ chatId }) {
  const { chats } = useStore(listStore);
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return null;
  return (
    <Menu
      trigger={({ toggle, open }) => (
        <button type="button" className={`title-btn ${open ? 'open' : ''}`} onClick={toggle}>
          <span>{chat.title}</span>
          <Ellipsis size={16} />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem
            icon={Pencil}
            onClick={async () => {
              close();
              const t = await promptDialog({ title: 'Rename chat', value: chat.title, action: 'Save' });
              if (t) renameChat(chat.id, t);
            }}
          >
            Rename
          </MenuItem>
          <MenuItem icon={chat.pinned ? PinOff : Pin} onClick={() => (close(), pinChat(chat.id, !chat.pinned))}>
            {chat.pinned ? 'Unpin' : 'Pin'}
          </MenuItem>
          <MenuItem
            icon={Trash2}
            danger
            onClick={async () => {
              close();
              if (await confirmDialog({ title: 'Delete chat?', body: `“${chat.title}” and its files will be permanently deleted.`, action: 'Delete', danger: true })) {
                await deleteChat(chat.id);
                location.replace('#/');
              }
            }}
          >
            Delete
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

export default function ChatView({ chatId, sidebarOpen, mobile, onToggleSidebar, onNewChat, onOpenImage }) {
  // A new chat gets its id up front so attachments can upload before the first message.
  const newId = useRef(uid());
  const prevChat = useRef(chatId);
  if (prevChat.current !== chatId) {
    if (!chatId) newId.current = uid();
    prevChat.current = chatId;
  }
  const id = chatId || newId.current;

  const st = useStore(chatStore(id));
  const { prefs, features } = useStore(appStore);
  const [mode, setMode] = useState(prefs.mode);
  const [web, setWeb] = useState(prefs.web);
  const [code, setCode] = useState(prefs.code);
  useEffect(() => setMode(prefs.mode), [prefs.mode]);
  useEffect(() => setWeb(prefs.web), [prefs.web]);
  useEffect(() => setCode(prefs.code), [prefs.code]);

  const opts = useRef();
  opts.current = { mode, web: web && features.web_enabled, code: code && features.code_enabled };

  useEffect(() => {
    if (chatId && !st.loaded) openChat(chatId);
  }, [chatId]);

  const path = useMemo(() => (st.leaf ? pathTo(st.msgs, st.leaf) : []), [st.msgs, st.leaf]);
  const tree = useMemo(() => buildTree(st.msgs), [st.msgs]);
  const streamingId = st.streaming?.id;
  const busy = !!st.streaming;
  const loading = !!chatId && !st.loaded;
  const empty = !loading && !st.error && path.length === 0;

  const composer = useRef(null);
  const scroller = useRef(null);
  const stick = useRef(true);
  const [showDown, setShowDown] = useState(false);

  const onScroll = () => {
    const el = scroller.current;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = gap < 140;
    setShowDown(gap > 400);
  };
  useLayoutEffect(() => {
    stick.current = true;
  }, [id]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  const toBottom = () => {
    stick.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  };

  const onSend = useCallback(
    ({ text, attachments }) => {
      stick.current = true;
      sendMessage(id, { text, attachments, ...opts.current });
      if (!chatId) location.replace(`#/c/${id}`);
    },
    [id, chatId],
  );
  const onEdit = useCallback((msgId, text) => editMessage(id, msgId, text, opts.current), [id]);
  const onRegenerate = useCallback(
    (msgId, m) => {
      stick.current = true;
      regenerate(id, msgId, { ...opts.current, mode: m || opts.current.mode });
    },
    [id],
  );
  const onBranch = useCallback((msgId, dir) => switchBranch(id, msgId, dir), [id]);
  const onReply = useCallback((msgId) => replyTo(id, msgId, opts.current), [id]);

  // Drag and drop files anywhere on the chat.
  const [drag, setDrag] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const dnd = {
    onDragEnter: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDrag(true);
    },
    onDragLeave: (e) => {
      if (!hasFiles(e)) return;
      if (--depth.current <= 0) {
        depth.current = 0;
        setDrag(false);
      }
    },
    onDragOver: (e) => hasFiles(e) && e.preventDefault(),
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDrag(false);
      composer.current?.addFiles(e.dataTransfer.files);
    },
  };

  const paused = !features.chat_enabled;

  return (
    <div className={`chat ${empty ? 'empty' : ''}`} {...dnd}>
      <header className="topbar">
        {(!sidebarOpen || mobile) && (
          <IconBtn label="Open sidebar" onClick={onToggleSidebar}>
            <PanelLeft size={20} />
          </IconBtn>
        )}
        {!sidebarOpen && !mobile && (
          <IconBtn label="New chat" onClick={onNewChat}>
            <SquarePen size={19} />
          </IconBtn>
        )}
        <div className="topbar-title">{chatId && !empty && <ChatTitle chatId={chatId} />}</div>
        {mobile && (
          <IconBtn label="New chat" onClick={onNewChat}>
            <SquarePen size={19} />
          </IconBtn>
        )}
      </header>

      {features.announcement && <Announcement text={features.announcement} />}

      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        {empty ? (
          <div className="hero" key={`hero-${id}`}>
            <Logo size={46} className="flicker hero-logo" />
            <h1 className="hero-title">{greeting(prefs.name)}</h1>
          </div>
        ) : loading ? (
          <div className="thread-loading">
            <Logo size={32} className="flicker" />
          </div>
        ) : st.error ? (
          <div className="thread-missing">
            <h2>{st.error === 'missing' ? 'This chat doesn’t exist anymore' : 'Couldn’t open this chat'}</h2>
            <p>{st.error === 'missing' ? 'It may have been deleted.' : st.error}</p>
            <button className="btn primary" onClick={onNewChat}>
              Start a new chat
            </button>
          </div>
        ) : (
          <div className="thread">
            {path.map((m, i) => {
              const sibs = tree.get(m.parentId || 'root') || [m.id];
              const index = Math.max(0, sibs.indexOf(m.id));
              return m.role === 'user' ? (
                <UserMessage
                  key={m.id}
                  m={m}
                  index={index}
                  count={sibs.length}
                  busy={busy}
                  dangling={i === path.length - 1 && !busy}
                  onEdit={onEdit}
                  onBranch={onBranch}
                  onReply={onReply}
                  onOpenImage={onOpenImage}
                />
              ) : (
                <AssistantMessage
                  key={m.id}
                  m={m}
                  streaming={m.id === streamingId}
                  index={index}
                  count={sibs.length}
                  busy={busy}
                  onRegenerate={onRegenerate}
                  onBranch={onBranch}
                  onOpenImage={onOpenImage}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="dock">
        {showDown && !empty && (
          <button type="button" className="to-bottom" onClick={toBottom} aria-label="Scroll to bottom">
            <ArrowDown size={18} />
          </button>
        )}
        {paused && (
          <div className="banner paused">
            <PauseCircle size={16} />
            <span>{features.pause_message}</span>
          </div>
        )}
        <Composer
          key={id}
          ref={composer}
          chatId={id}
          draftKey={chatId || 'new'}
          onSend={onSend}
          streaming={busy}
          onStop={() => stop(id)}
          paused={paused}
          mode={mode}
          setMode={setMode}
          web={web}
          setWeb={setWeb}
          code={code}
          setCode={setCode}
          features={features}
          enterSend={prefs.enter_send}
          autoFocus
        />
        {empty ? (
          <div className="suggestions">
            {SUGGESTIONS.filter((s) => !s.attach || features.uploads_enabled).map((s, i) => (
              <button
                key={s.label}
                type="button"
                className="suggestion"
                style={{ animationDelay: `${120 + i * 50}ms` }}
                disabled={paused}
                onClick={() => {
                  if (s.attach) composer.current?.openFiles();
                  else if (s.send) onSend({ text: s.prompt, attachments: [] });
                  else composer.current?.setText(s.prompt);
                }}
              >
                <s.icon size={16} />
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="footnote">DiyaGPT can make mistakes. Check important info.</p>
        )}
      </div>

      {drag && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Upload size={28} />
            <strong>Drop files here</strong>
            <span>Photos, PDFs, documents, spreadsheets, code…</span>
          </div>
        </div>
      )}
    </div>
  );
}
