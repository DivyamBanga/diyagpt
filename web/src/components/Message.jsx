import { memo, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, File, FileArchive,
  FileAudio, FileCode, FileSpreadsheet, FileText, FileVideo, Globe, Lightbulb, Pencil, Presentation,
  RefreshCw, Terminal, Volume2, VolumeX, Zap,
} from 'lucide-react';
import Markdown, { CodeBlock, GenImage } from './Markdown';
import { IconBtn, Menu, MenuItem } from './ui';
import { downloadFile } from '../api';
import { bytes, copyText } from '../lib/util';
import { fileKindLabel, isImageName } from '../lib/files';
import { canSpeak, speak, stopSpeaking } from '../lib/speech';

const KIND_ICONS = {
  PDF: FileText, Document: FileText, Text: FileText, Spreadsheet: FileSpreadsheet, Presentation, Archive: FileArchive,
  Audio: FileAudio, Video: FileVideo, Code: FileCode, JSON: FileCode, XML: FileCode, YAML: FileCode, YML: FileCode,
};

export function FileChip({ name, mime, size, sub, onClick, children, className = '' }) {
  const label = fileKindLabel(name, mime);
  const Icon = KIND_ICONS[label] || File;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`file-chip ${className}`} onClick={onClick} title={name}>
      <span className={`file-icon k-${label.toLowerCase()}`}>
        <Icon size={18} />
      </span>
      <span className="file-meta">
        <span className="file-name">{name}</span>
        <span className="file-sub">{sub ?? [label, size ? bytes(size) : ''].filter(Boolean).join(' · ')}</span>
      </span>
      {children}
    </Tag>
  );
}

function BranchNav({ index, count, onBranch, disabled }) {
  if (count < 2) return null;
  return (
    <span className="branch-nav">
      <IconBtn label="Previous version" onClick={() => onBranch(-1)} disabled={disabled || index === 0}>
        <ChevronLeft size={16} />
      </IconBtn>
      <span className="branch-count">
        {index + 1}/{count}
      </span>
      <IconBtn label="Next version" onClick={() => onBranch(1)} disabled={disabled || index === count - 1}>
        <ChevronRight size={16} />
      </IconBtn>
    </span>
  );
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <IconBtn
      label={done ? 'Copied' : 'Copy'}
      onClick={async () => {
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={16} /> : <Copy size={16} />}
    </IconBtn>
  );
}

// ---------- user ----------

export const UserMessage = memo(function UserMessage({ m, index, count, busy, dangling, onEdit, onBranch, onReply, onOpenImage }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const ta = useRef(null);

  useEffect(() => {
    if (!editing) return;
    const el = ta.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = 'auto';
    ta.current.style.height = `${Math.min(ta.current.scrollHeight, 360)}px`;
  }, [draft, editing]);

  const submit = () => {
    if (!draft.trim() && !m.attachments?.length) return;
    setEditing(false);
    onEdit(m.id, draft.trim());
  };

  const images = (m.attachments || []).filter((a) => a.kind === 'image');
  const files = (m.attachments || []).filter((a) => a.kind !== 'image');

  return (
    <div className="msg user">
      {(images.length > 0 || files.length > 0) && (
        <div className="msg-atts">
          {images.map((a) => (
            <button key={a.id} type="button" className="att-img" onClick={() => onOpenImage(a)} title={a.name}>
              <img src={a.thumb} alt={a.name} style={a.w && a.h ? { aspectRatio: `${a.w} / ${a.h}` } : undefined} />
            </button>
          ))}
          {files.map((a) => (
            <FileChip key={a.id} name={a.name} mime={a.mime} size={a.size} onClick={() => downloadFile(a.id, a.name, a.mime)} sub={a.kind === 'data' ? `${fileKindLabel(a.name, a.mime)} · for analysis` : undefined} />
          ))}
        </div>
      )}
      {editing ? (
        <div className="edit-box">
          <textarea
            ref={ta}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(hover: hover)').matches) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="edit-actions">
            <button className="btn ghost sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn primary sm" onClick={submit} disabled={busy}>
              Send
            </button>
          </div>
        </div>
      ) : (
        m.text && <div className="bubble">{m.text}</div>
      )}
      {!editing && (
        <div className="msg-actions">
          {m.text && <CopyBtn text={m.text} />}
          <IconBtn
            label="Edit message"
            disabled={busy}
            onClick={() => {
              setDraft(m.text);
              setEditing(true);
            }}
          >
            <Pencil size={15} />
          </IconBtn>
          <BranchNav index={index} count={count} onBranch={(d) => onBranch(m.id, d)} disabled={busy} />
        </div>
      )}
      {dangling && !editing && (
        <div className="dangling">
          <span>No reply yet.</span>
          <button className="btn ghost sm" onClick={() => onReply(m.id)}>
            <RefreshCw size={14} /> Get a reply
          </button>
        </div>
      )}
    </div>
  );
});

// ---------- assistant ----------

const secs = (ms) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

function liveLabel(steps) {
  const s = steps[steps.length - 1];
  if (!s) return 'Thinking';
  if (s.type === 'reasoning') {
    const heads = [...s.text.matchAll(/\*\*([^*\n]{3,80})\*\*/g)];
    return heads.length ? heads[heads.length - 1][1] : 'Thinking';
  }
  if (s.type === 'search') return s.status === 'running' ? 'Searching the web' : s.queries?.[0] ? `Searched “${s.queries[0]}”` : 'Reading results';
  if (s.type === 'code') return s.status === 'running' ? 'Running code' : 'Analyzing results';
  if (s.type === 'note') return s.text.split('\n')[0].slice(0, 90) || 'Working';
  return 'Thinking';
}

function doneLabel(m) {
  const steps = m.steps || [];
  const reasoned = steps.some((s) => s.type === 'reasoning' && s.text);
  const searched = steps.filter((s) => s.type === 'search').length;
  const coded = steps.some((s) => s.type === 'code');
  if (reasoned) return `Thought for ${secs(m.thinkingMs || 0)}`;
  if (searched) return searched === 1 ? 'Searched the web' : `Searched the web ${searched} times`;
  if (coded) return 'Ran code';
  return 'Worked';
}

function Step({ s, onOpenImage }) {
  if (s.type === 'reasoning')
    return s.text ? (
      <div className="step">
        <span className="step-icon">
          <Lightbulb size={14} />
        </span>
        <Markdown text={s.text} className="step-md" />
      </div>
    ) : null;
  if (s.type === 'note')
    return s.text ? (
      <div className="step">
        <span className="step-icon">
          <Brain size={14} />
        </span>
        <Markdown text={s.text} className="step-md" />
      </div>
    ) : null;
  if (s.type === 'search') {
    const host = s.url ? (() => { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return s.url; } })() : '';
    return (
      <div className="step">
        <span className="step-icon">
          <Globe size={14} />
        </span>
        <div className="step-body">
          {s.action === 'open_page' && host ? (
            <span>Read {host}</span>
          ) : s.queries?.length ? (
            <div className="queries">
              {s.queries.map((q) => (
                <span key={q} className="query">
                  {q}
                </span>
              ))}
            </div>
          ) : (
            <span>{s.status === 'running' ? 'Searching the web…' : 'Searched the web'}</span>
          )}
        </div>
      </div>
    );
  }
  if (s.type === 'code')
    return (
      <div className="step">
        <span className="step-icon">
          <Terminal size={14} />
        </span>
        <div className="step-body">
          <span>{s.status === 'running' ? 'Running Python…' : 'Ran Python'}</span>
          {s.code && <CodeBlock code={s.code} lang="python" />}
          {s.logs && <pre className="logs">{s.logs}</pre>}
          {s.images?.map((src, i) => (
            <img key={i} className="step-img" src={src} alt="Output" />
          ))}
        </div>
      </div>
    );
  return null;
}

function Steps({ m, streaming, onOpenImage }) {
  const [open, setOpen] = useState(false);
  const steps = m.steps || [];
  const live = streaming && !m.text;
  if (!steps.length && !live) return null;
  return (
    <div className={`steps ${open ? 'open' : ''}`}>
      <button type="button" className={`steps-head ${live ? 'live' : ''}`} onClick={() => setOpen((o) => !o)} disabled={!steps.length}>
        <span className="steps-label">{live ? liveLabel(steps) : doneLabel(m)}</span>
        {steps.length > 0 && <ChevronDown size={15} className="chev" />}
      </button>
      {open && (
        <div className="steps-body">
          {steps.map((s) => (
            <Step key={s.id} s={s} onOpenImage={onOpenImage} />
          ))}
        </div>
      )}
    </div>
  );
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const favicon = (url) => `https://www.google.com/s2/favicons?domain=${hostOf(url)}&sz=64`;

function Sources({ list }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sources">
      <button type="button" className={`sources-btn ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span className="favs">
          {list.slice(0, 3).map((c) => (
            <img key={c.url} src={favicon(c.url)} alt="" />
          ))}
        </span>
        Sources
        <span className="count">{list.length}</span>
      </button>
      {open && (
        <ul className="sources-list">
          {list.map((c) => (
            <li key={c.url}>
              <a href={c.url} target="_blank" rel="noopener noreferrer">
                <img src={favicon(c.url)} alt="" />
                <span className="src-title">{c.title || hostOf(c.url)}</span>
                <span className="src-host">{hostOf(c.url)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Code interpreter often returns the same chart twice: an auto-captured figure and a saved file the
// answer links to. Show unlinked figures inline; fall back to linked ones only if there are none.
function GeneratedFiles({ files, text, onOpenImage }) {
  if (!files?.length) return null;
  const t = text || '';
  const embedded = (f) => new RegExp(`!\\[[^\\]]*\\]\\(sandbox:${f.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t);
  const linked = (f) => t.includes(`sandbox:${f.path}`);
  const imgs = files.filter((f) => isImageName(f.name) && f.id && !embedded(f));
  const unlinked = imgs.filter((f) => !linked(f));
  const images = unlinked.length ? unlinked : imgs;
  const others = files.filter((f) => !isImageName(f.name) || !f.id);
  return (
    <div className="gen-files">
      {images.map((f) => (
        <GenImage key={f.cfile} file={f} onOpen={onOpenImage} />
      ))}
      {others.length > 0 && (
        <div className="gen-chips">
          {others.map((f) => (
            <FileChip
              key={f.cfile}
              name={f.name}
              mime={f.mime}
              size={f.bytes}
              sub={f.expired ? 'Expired before it could be saved' : undefined}
              className={f.expired ? 'expired' : ''}
              onClick={f.id ? () => downloadFile(f.id, f.name, f.mime) : undefined}
            >
              {f.id && <Download size={16} className="chip-dl" />}
            </FileChip>
          ))}
        </div>
      )}
    </div>
  );
}

const MODE_LABEL = { instant: 'Instant', thinking: 'Thinking', deep: 'Deep thinking' };

export const AssistantMessage = memo(function AssistantMessage({ m, streaming, index, count, busy, onRegenerate, onBranch, onOpenImage }) {
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  speakingRef.current = speaking;
  useEffect(() => () => speakingRef.current && stopSpeaking(), []);

  const toggleSpeak = () => {
    if (speaking) stopSpeaking();
    else {
      speak(m.text, () => setSpeaking(false));
      setSpeaking(true);
    }
  };

  return (
    <div className={`msg assistant ${streaming ? 'streaming' : ''}`}>
      <Steps m={m} streaming={streaming} onOpenImage={onOpenImage} />
      {m.text && <Markdown text={m.text} files={m.files} saving={m.saving || streaming} onOpenImage={onOpenImage} />}
      {streaming && m.text && <span className="cursor" aria-hidden="true" />}
      {m.saving && <div className="notice subtle">Saving files…</div>}
      <GeneratedFiles files={m.files} text={m.text} onOpenImage={onOpenImage} />
      {!streaming && m.citations?.length > 0 && <Sources list={m.citations} />}
      {m.notice && <div className="notice">{m.notice}</div>}
      {m.status === 'stopped' && <div className="notice subtle">Stopped</div>}
      {m.status === 'error' && (
        <div className="error-card">
          <AlertTriangle size={16} />
          <span>{m.error}</span>
          <button className="btn ghost sm" onClick={() => onRegenerate(m.id)} disabled={busy}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}
      {!streaming && !m.local && (
        <div className="msg-actions assistant-actions">
          {m.text && <CopyBtn text={m.text} />}
          {m.text && canSpeak() && (
            <IconBtn label={speaking ? 'Stop reading' : 'Read aloud'} onClick={toggleSpeak} active={speaking}>
              {speaking ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </IconBtn>
          )}
          <Menu
            side="top"
            trigger={({ toggle }) => (
              <IconBtn label="Regenerate" onClick={toggle} disabled={busy}>
                <RefreshCw size={15} />
              </IconBtn>
            )}
          >
            {(close) => (
              <>
                <div className="menu-label">Regenerate{m.mode ? ` · was ${MODE_LABEL[m.mode]}` : ''}</div>
                <MenuItem icon={RefreshCw} onClick={() => (close(), onRegenerate(m.id))}>
                  Try again
                </MenuItem>
                <MenuItem icon={Brain} onClick={() => (close(), onRegenerate(m.id, 'deep'))}>
                  Think longer
                </MenuItem>
                <MenuItem icon={Zap} onClick={() => (close(), onRegenerate(m.id, 'instant'))}>
                  Answer instantly
                </MenuItem>
              </>
            )}
          </Menu>
          <BranchNav index={index} count={count} onBranch={(d) => onBranch(m.id, d)} disabled={busy} />
        </div>
      )}
    </div>
  );
});
