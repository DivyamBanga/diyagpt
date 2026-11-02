import { useEffect, useState } from 'react';
import { Laptop, LogOut, ShieldCheck, Smartphone, SlidersHorizontal, Sparkles, Trash2, UserRound } from 'lucide-react';
import { CloseBtn, Modal, Switch, confirmDialog } from './ui';
import { MODES } from './Composer';
import { api } from '../api';
import { appStore, deleteAllChats, savePrefs, toast, useStore } from '../state/store';
import { ago } from '../lib/util';

const TABS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'personal', label: 'Personalization', icon: Sparkles },
  { id: 'devices', label: 'Devices & data', icon: ShieldCheck },
];

function Segmented({ value, options, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'active' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ title, desc, children }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-title">{title}</div>
        {desc && <div className="set-desc">{desc}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function General({ prefs }) {
  return (
    <div className="set-group">
      <Row title="Theme">
        <Segmented label="Theme" value={prefs.theme} onChange={(theme) => savePrefs({ theme })} options={[{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} />
      </Row>
      <Row title="Text size">
        <Segmented label="Text size" value={prefs.font} onChange={(font) => savePrefs({ font })} options={[{ id: 'sm', label: 'Small' }, { id: 'md', label: 'Default' }, { id: 'lg', label: 'Large' }]} />
      </Row>
      <Row title="Default thinking" desc="How much DiyaGPT thinks before answering new messages.">
        <Segmented label="Default thinking" value={prefs.mode} onChange={(mode) => savePrefs({ mode })} options={MODES.map((m) => ({ id: m.id, label: m.id === 'deep' ? 'Deep' : m.label }))} />
      </Row>
      <Row title="Web search" desc="Let DiyaGPT look things up online when it helps.">
        <Switch label="Web search" checked={prefs.web} onChange={(web) => savePrefs({ web })} />
      </Row>
      <Row title="Code & analysis" desc="Let DiyaGPT run Python for math, data, charts and files.">
        <Switch label="Code and analysis" checked={prefs.code} onChange={(code) => savePrefs({ code })} />
      </Row>
      <Row title="Send with Enter" desc="Shift + Enter adds a new line. On phones, Enter always adds a line.">
        <Switch label="Send with Enter" checked={prefs.enter_send} onChange={(enter_send) => savePrefs({ enter_send })} />
      </Row>
    </div>
  );
}

function Personal({ prefs }) {
  const [form, setForm] = useState({ name: prefs.name, about: prefs.about, style: prefs.style });
  const dirty = form.name !== prefs.name || form.about !== prefs.about || form.style !== prefs.style;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className="set-group personal"
      onSubmit={async (e) => {
        e.preventDefault();
        await savePrefs(form);
        toast('Saved', 'success');
      }}
    >
      <label className="field-label">
        What should DiyaGPT call you?
        <input className="field" value={form.name} onChange={set('name')} maxLength={60} placeholder="Your name" />
      </label>
      <label className="field-label">
        What should DiyaGPT know about you?
        <textarea className="field" rows={4} value={form.about} onChange={set('about')} maxLength={3000} placeholder="Interests, what you study or do, things you care about…" />
      </label>
      <label className="field-label">
        How should DiyaGPT respond?
        <textarea className="field" rows={4} value={form.style} onChange={set('style')} maxLength={3000} placeholder="e.g. Keep it short and friendly. Use bullet points for steps." />
      </label>
      <div className="set-actions">
        <button className="btn primary" type="submit" disabled={!dirty}>
          Save
        </button>
      </div>
    </form>
  );
}

function Devices({ onLogout, onClose }) {
  const [sessions, setSessions] = useState(null);
  const load = () =>
    api
      .get('/api/sessions')
      .then((r) => setSessions(r.sessions))
      .catch((e) => toast(e.message, 'error'));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="set-group">
      <h3 className="set-heading">Signed-in devices</h3>
      <div className="devices">
        {!sessions && <div className="mini-spin" />}
        {sessions?.map((s) => (
          <div key={s.id} className="device">
            {/iPhone|Android|iPad/.test(s.device) ? <Smartphone size={18} /> : <Laptop size={18} />}
            <div className="device-text">
              <div className="device-name">
                {s.device}
                {s.current && <span className="badge">This device</span>}
              </div>
              <div className="device-sub">
                {s.location} · active {ago(s.last_seen)}
              </div>
            </div>
            {!s.current && (
              <button
                className="btn ghost sm"
                onClick={async () => {
                  await api.del(`/api/sessions/${s.id}`).catch((e) => toast(e.message, 'error'));
                  load();
                }}
              >
                Sign out
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="set-note">If you see a device you don’t recognize, sign it out and let the admin know so the password can be changed.</p>

      <h3 className="set-heading">Your data</h3>
      <Row title="Delete all chats" desc="Permanently removes every chat and uploaded file.">
        <button
          className="btn danger-ghost"
          onClick={async () => {
            const ok = await confirmDialog({ title: 'Delete all chats?', body: 'Every chat and uploaded file will be permanently deleted. This can’t be undone.', action: 'Delete everything', danger: true });
            if (!ok) return;
            try {
              await deleteAllChats();
              toast('All chats deleted', 'success');
              onClose();
              location.replace('#/');
            } catch (e) {
              toast(e.message, 'error');
            }
          }}
        >
          <Trash2 size={15} /> Delete all
        </button>
      </Row>
      <Row title="Log out" desc="Sign out of DiyaGPT on this device.">
        <button className="btn ghost" onClick={onLogout}>
          <LogOut size={15} /> Log out
        </button>
      </Row>
      <p className="set-note privacy">
        <UserRound size={14} /> Your conversations are private to you. The admin can see usage totals (like how many messages were sent) and sign-in activity, but never the content of your chats.
      </p>
    </div>
  );
}

export default function SettingsModal({ open, onClose, onLogout }) {
  const [tab, setTab] = useState('general');
  const { prefs } = useStore(appStore);
  useEffect(() => {
    if (open) setTab('general');
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} label="Settings" className="settings">
      <div className="settings-head">
        <h2>Settings</h2>
        <CloseBtn onClick={onClose} />
      </div>
      <div className="settings-body">
        <nav className="settings-tabs">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="settings-panel">
          {tab === 'general' && <General prefs={prefs} />}
          {tab === 'personal' && <Personal prefs={prefs} />}
          {tab === 'devices' && <Devices onLogout={onLogout} onClose={onClose} />}
        </div>
      </div>
    </Modal>
  );
}
