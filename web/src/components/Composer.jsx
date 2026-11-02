import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Brain, Check, ChevronDown, Globe, Lightbulb, Mic, Paperclip, Plus, RefreshCw, Square, Terminal, X, Zap } from 'lucide-react';
import { uploadFile } from '../api';
import { MAX_FILE, MAX_FILES, classify, fileKindLabel, prepareImage } from '../lib/files';
import { canDictate, startDictation } from '../lib/speech';
import { isTouch, uid } from '../lib/util';
import { toast } from '../state/store';
import { FileChip } from './Message';
import { IconBtn, Menu, MenuItem } from './ui';

export const MODES = [
  { id: 'instant', label: 'Instant', desc: 'Answers right away', icon: Zap },
  { id: 'thinking', label: 'Thinking', desc: 'Thinks before answering', icon: Lightbulb },
  { id: 'deep', label: 'Deep thinking', desc: 'Takes longer on hard problems', icon: Brain },
];

const drafts = new Map();

function Ring({ value }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`ring ${value == null ? 'spin' : ''}`} viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r={r} className="ring-track" />
      <circle cx="12" cy="12" r={r} className="ring-bar" strokeDasharray={c} strokeDashoffset={value == null ? c * 0.7 : c * (1 - value)} />
    </svg>
  );
}

function AttChip({ a, onRemove, onRetry }) {
  const remove = (
    <button type="button" className="att-x" onClick={() => onRemove(a.key)} aria-label={`Remove ${a.name}`}>
      <X size={12} strokeWidth={2.5} />
    </button>
  );
  if (a.kind === 'image')
    return (
      <div className={`att-thumb ${a.status}`} title={a.status === 'error' ? a.error : a.name}>
        {a.thumb ? <img src={a.thumb} alt={a.name} /> : <span className="att-ph" />}
        {(a.status === 'processing' || a.status === 'uploading') && (
          <span className="att-overlay">
            <Ring value={a.status === 'uploading' ? a.progress : null} />
          </span>
        )}
        {a.status === 'error' && (
          <button type="button" className="att-overlay err" onClick={() => onRetry(a.key)} aria-label="Retry upload">
            <RefreshCw size={16} />
          </button>
        )}
        {remove}
      </div>
    );
  const sub =
    a.status === 'error'
      ? a.error
      : a.status === 'processing'
        ? 'Preparing…'
        : a.status === 'uploading'
          ? `Uploading ${Math.round(a.progress * 100)}%`
          : a.kind === 'data'
            ? `${fileKindLabel(a.name, a.mime)} · for analysis`
            : undefined;
  return (
    <FileChip name={a.name} mime={a.mime} size={a.size} sub={sub} className={`att-file ${a.status}`}>
      {a.status === 'uploading' && <Ring value={a.progress} />}
      {a.status === 'error' && (
        <button type="button" className="att-retry" onClick={() => onRetry(a.key)} aria-label="Retry upload">
          <RefreshCw size={14} />
        </button>
      )}
      {remove}
    </FileChip>
  );
}

function ModePicker({ mode, setMode }) {
  const cur = MODES.find((m) => m.id === mode) || MODES[1];
  const Icon = cur.icon;
  return (
    <Menu
      side="top"
      trigger={({ toggle, open }) => (
        <button type="button" className={`mode-btn ${open ? 'open' : ''}`} onClick={toggle} aria-label={`Thinking mode: ${cur.label}`}>
          <Icon size={15} />
          <span>{cur.label}</span>
          <ChevronDown size={14} className="chev" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="menu-label">How much should it think?</div>
          {MODES.map((m) => (
            <MenuItem
              key={m.id}
              icon={m.icon}
              onClick={() => {
                setMode(m.id);
                close();
              }}
              right={m.id === mode ? <Check size={16} className="menu-check" /> : null}
            >
              <span className="mi-title">{m.label}</span>
              <span className="mi-desc">{m.desc}</span>
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

const Composer = forwardRef(function Composer(
  { chatId, draftKey, onSend, streaming, onStop, paused, mode, setMode, web, setWeb, code, setCode, features, enterSend, autoFocus },
  ref,
) {
  const [text, setText] = useState(() => drafts.get(draftKey) || '');
  const [atts, setAtts] = useState([]);
  const [listening, setListening] = useState(false);
  const ta = useRef(null);
  const fileInput = useRef(null);
  const stopDictation = useRef(null);
  const base = useRef('');
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(
    () => () => {
      if (textRef.current.trim()) drafts.set(draftKey, textRef.current);
      else drafts.delete(draftKey);
    },
    [draftKey],
  );
  useEffect(() => () => stopDictation.current?.(), []);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Math.max(160, window.innerHeight * 0.38))}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus && !isTouch()) ta.current?.focus();
  }, [autoFocus]);

  const update = (key, patch) => setAtts((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  async function process(a) {
    try {
      let blob = a.file;
      let name = a.file.name;
      let extra = {};
      if (a.kind === 'image') {
        const p = await prepareImage(a.file);
        blob = p.blob;
        name = p.name;
        extra = { thumb: p.thumb, w: p.w, h: p.h, mime: p.mime, name: p.name };
        update(a.key, { thumb: p.thumb });
      } else if (a.kind === 'text') name = `${a.file.name}.txt`;
      update(a.key, { status: 'uploading', progress: 0 });
      const r = await uploadFile(blob, name, chatId, (p) => update(a.key, { progress: p }), a.ctrl.signal);
      update(a.key, { status: 'done', id: r.id, ...extra });
    } catch (e) {
      if (e.name === 'AbortError') return;
      update(a.key, { status: 'error', error: e.message || 'Upload failed' });
    }
  }

  function addFiles(list) {
    if (!features?.uploads_enabled) return toast('File uploads are turned off right now.', 'error');
    const files = [...(list || [])];
    if (!files.length) return;
    const room = MAX_FILES - atts.length;
    if (files.length > room) toast(`You can attach up to ${MAX_FILES} files per message.`, 'error');
    const accepted = [];
    for (const f of files.slice(0, Math.max(0, room))) {
      if (f.size > MAX_FILE) {
        toast(`“${f.name}” is over 50 MB.`, 'error');
        continue;
      }
      if (!f.size) {
        toast(`“${f.name}” is empty.`, 'error');
        continue;
      }
      accepted.push({ key: uid(), file: f, name: f.name, size: f.size, mime: f.type, kind: classify(f), status: 'processing', progress: 0, ctrl: new AbortController() });
    }
    if (!accepted.length) return;
    setAtts((l) => [...l, ...accepted]);
    accepted.forEach(process);
    ta.current?.focus({ preventScroll: true });
  }

  const remove = (key) =>
    setAtts((list) => {
      list.find((a) => a.key === key)?.ctrl.abort();
      return list.filter((a) => a.key !== key);
    });

  const retry = (key) => {
    const a = atts.find((x) => x.key === key);
    if (!a) return;
    const fresh = { ...a, status: 'processing', progress: 0, error: null, ctrl: new AbortController() };
    update(key, fresh);
    process(fresh);
  };

  useImperativeHandle(ref, () => ({
    addFiles,
    openFiles: () => fileInput.current?.click(),
    setText: (t) => {
      setText(t);
      requestAnimationFrame(() => {
        const el = ta.current;
        el?.focus();
        el?.setSelectionRange(t.length, t.length);
      });
    },
  }));

  const uploading = atts.some((a) => a.status === 'processing' || a.status === 'uploading');
  const ready = atts.filter((a) => a.status === 'done');
  const canSend = !paused && !uploading && (text.trim().length > 0 || ready.length > 0);

  function submit() {
    if (streaming || !canSend) return;
    stopDictation.current?.();
    onSend({
      text: text.trim(),
      attachments: ready.map((a) => ({
        id: a.id,
        name: a.name,
        mime: a.mime || '',
        size: a.size,
        kind: a.kind === 'image' ? 'image' : a.kind === 'data' ? 'data' : 'file',
        ...(a.thumb ? { thumb: a.thumb, w: a.w, h: a.h } : {}),
      })),
    });
    setText('');
    setAtts([]);
    drafts.delete(draftKey);
    if (isTouch()) ta.current?.blur();
  }

  function toggleMic() {
    if (listening) return stopDictation.current?.();
    base.current = text ? `${text.replace(/\s*$/, '')} ` : '';
    setListening(true);
    try {
      stopDictation.current = startDictation({
        onText: (final, interim) => {
          if (final) base.current += final;
          setText(base.current + interim);
        },
        onEnd: () => {
          setListening(false);
          stopDictation.current = null;
          setText(base.current);
        },
        onError: (err) => {
          if (err === 'not-allowed' || err === 'service-not-allowed') toast('Microphone access is blocked for this site.', 'error');
        },
      });
    } catch {
      setListening(false);
    }
  }

  const placeholder = paused ? 'DiyaGPT is paused right now' : listening ? 'Listening…' : 'Ask anything';

  return (
    <div className={`composer ${paused ? 'paused' : ''} ${listening ? 'listening' : ''}`}>
      {atts.length > 0 && (
        <div className="composer-atts">
          {atts.map((a) => (
            <AttChip key={a.key} a={a} onRemove={remove} onRetry={retry} />
          ))}
        </div>
      )}
      <textarea
        ref={ta}
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label="Message DiyaGPT"
        disabled={paused}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterSend && !isTouch()) {
            e.preventDefault();
            submit();
          }
        }}
        onPaste={(e) => {
          const files = [...(e.clipboardData?.files || [])];
          if (!files.length || e.clipboardData.getData('text/plain')) return;
          e.preventDefault();
          addFiles(files);
        }}
      />
      <div className="composer-bar">
        <Menu
          side="top"
          trigger={({ toggle, open }) => (
            <IconBtn label="Add files and tools" onClick={toggle} className={`plus ${open ? 'open' : ''}`} disabled={paused}>
              <Plus size={20} />
            </IconBtn>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon={Paperclip}
                disabled={!features?.uploads_enabled}
                onClick={() => {
                  close();
                  fileInput.current?.click();
                }}
              >
                Add photos & files
              </MenuItem>
              {(features?.web_enabled || features?.code_enabled) && <div className="menu-sep" />}
              {features?.web_enabled && (
                <MenuItem icon={Globe} role="menuitemcheckbox" aria-checked={web} onClick={() => setWeb(!web)} right={<span className={`switch ${web ? 'on' : ''}`}><span /></span>}>
                  <span className="mi-title">Web search</span>
                  <span className="mi-desc">Look things up when needed</span>
                </MenuItem>
              )}
              {features?.code_enabled && (
                <MenuItem icon={Terminal} role="menuitemcheckbox" aria-checked={code} onClick={() => setCode(!code)} right={<span className={`switch ${code ? 'on' : ''}`}><span /></span>}>
                  <span className="mi-title">Code & analysis</span>
                  <span className="mi-desc">Run Python, make charts and files</span>
                </MenuItem>
              )}
            </>
          )}
        </Menu>
        <ModePicker mode={mode} setMode={setMode} />
        {features?.web_enabled && !web && (
          <button type="button" className="tool-off" onClick={() => setWeb(true)} title="Turn web search back on">
            <Globe size={13} /> Search off
          </button>
        )}
        <div className="spacer" />
        {canDictate() && !streaming && !paused && (
          <IconBtn label={listening ? 'Stop dictation' : 'Dictate'} onClick={toggleMic} className={`mic ${listening ? 'live' : ''}`}>
            <Mic size={18} />
          </IconBtn>
        )}
        {streaming ? (
          <button type="button" className="send stop" onClick={onStop} aria-label="Stop generating">
            <Square size={13} fill="currentColor" strokeWidth={0} />
          </button>
        ) : (
          <button type="button" className="send" onClick={submit} disabled={!canSend} aria-label="Send message">
            <ArrowUp size={19} strokeWidth={2.3} />
          </button>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
});

export default Composer;
