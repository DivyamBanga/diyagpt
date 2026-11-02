import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, BellRing, Copy, ExternalLink, Gauge, KeyRound, Laptop, LayoutDashboard, LogIn, LogOut,
  MessageSquare, Power, RefreshCw, Send, Settings2, ShieldAlert, ShieldCheck, Smartphone, Table2, Unlock, UserX,
} from 'lucide-react';
import Login from '../components/Login';
import Logo from '../components/Logo';
import { Dialogs, IconBtn, Splash, Switch, Toasts, confirmDialog } from '../components/ui';
import { api, onSignedOut, tokens } from '../api';
import { toast } from '../state/store';
import { ago, bytes, copyText, stamp } from '../lib/util';
import { Columns, compact, dayLabel } from './Charts';
import '../styles/admin.css';

const A = { role: 'admin' };

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'controls', label: 'Controls', icon: Settings2 },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'alerts', label: 'Alerts', icon: Bell },
];

const CATEGORY = {
  user_login: 'signin', admin_login: 'signin',
  user_login_failed: 'security', admin_login_failed: 'security', lockout: 'security', global_lockout: 'security', unlocked: 'security',
  settings_changed: 'admin', password_changed: 'admin', sessions_revoked: 'admin',
  api_error: 'errors', limit_reached: 'errors',
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'signin', label: 'Sign-ins' },
  { id: 'security', label: 'Security' },
  { id: 'admin', label: 'Admin' },
  { id: 'errors', label: 'Usage & errors' },
];

function eventIcon(e) {
  const c = CATEGORY[e.type];
  if (e.type === 'lockout' || e.type === 'global_lockout') return ShieldAlert;
  if (c === 'signin') return LogIn;
  if (c === 'security') return e.type === 'unlocked' ? Unlock : KeyRound;
  if (c === 'admin') return Settings2;
  if (c === 'errors') return AlertTriangle;
  return Activity;
}

const LEVEL_LABEL = { info: 'Info', warn: 'Warning', alert: 'Alert' };

function EventRow({ e }) {
  const Icon = eventIcon(e);
  const meta = e.meta ? JSON.parse(e.meta) : null;
  return (
    <li className={`ev lv-${e.level} ${e.seen ? '' : 'unseen'}`}>
      <span className="ev-icon" title={LEVEL_LABEL[e.level]}>
        <Icon size={15} />
      </span>
      <div className="ev-main">
        <div className="ev-msg">{e.message}</div>
        <div className="ev-sub">
          <span title={new Date(e.ts).toLocaleString()}>{ago(e.ts)}</span>
          {meta?.ip && <span>IP {meta.ip}</span>}
          {e.level !== 'info' && <span className={`ev-level lv-${e.level}`}>{LEVEL_LABEL[e.level]}</span>}
        </div>
      </div>
    </li>
  );
}

function fillDays(daily, today, n) {
  const map = new Map(daily.map((d) => [d.day, d]));
  const out = [];
  const end = new Date(`${today}T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const d = map.get(day) || {};
    out.push({ day, messages: d.messages || 0, input: d.input || 0, output: d.output || 0, cached: d.cached || 0 });
  }
  return out;
}

const costOf = (d, cfg) => (((d.input || 0) - (d.cached || 0)) * cfg.price_in + (d.cached || 0) * cfg.price_in * 0.1 + (d.output || 0) * cfg.price_out) / 1e6;
const money = (v) => (v < 0.01 && v > 0 ? '<$0.01' : `$${v.toFixed(v < 10 ? 2 : 0)}`);

function Tile({ label, value, sub, icon: Icon }) {
  return (
    <div className="tile">
      <div className="tile-label">
        {Icon && <Icon size={14} />}
        {label}
      </div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

function StatusPill({ cfg }) {
  const now = Date.now();
  const locked = cfg.user_global_lock_until > now;
  const state = !cfg.chat_enabled ? ['paused', 'Chat paused'] : !cfg.login_enabled ? ['warn', 'Sign-in off'] : locked ? ['alert', 'Sign-in locked'] : ['live', 'Live'];
  return (
    <span className={`status-pill ${state[0]}`}>
      <span className="dot" />
      {state[1]}
    </span>
  );
}

// ---------- overview ----------

function Overview({ data, saveConfig, reload, goto }) {
  const cfg = data.config;
  const [range, setRange] = useState(30);
  const [table, setTable] = useState(false);
  const days = useMemo(() => fillDays(data.daily, data.today, range), [data.daily, data.today, range]);
  const today = days[days.length - 1];
  const rangeCost = days.reduce((s, d) => s + costOf(d, cfg), 0);
  const rangeMsgs = days.reduce((s, d) => s + d.messages, 0);
  const userSessions = data.sessions.filter((s) => s.role === 'user').length;
  const globalLocked = cfg.user_global_lock_until > Date.now();

  const toggle = async (key, on, label) => {
    if (!on && !(await confirmDialog({ title: `Turn off ${label}?`, body: key === 'chat_enabled' ? 'DiyaGPT will show the pause message and won’t answer until you turn it back on.' : 'Nobody can sign in until you turn it back on. Devices already signed in stay signed in.', action: 'Turn off', danger: true }))) return;
    saveConfig({ [key]: on });
  };

  return (
    <div className="ad-stack">
      {globalLocked && (
        <div className="ad-alert">
          <ShieldAlert size={18} />
          <span>Sign-in is locked for everyone until {stamp(cfg.user_global_lock_until)} after many wrong passwords.</span>
          <button
            className="btn sm primary"
            onClick={async () => {
              await api.post('/api/admin/unlock', {}, A);
              toast('Lockouts cleared', 'success');
              reload();
            }}
          >
            Unlock now
          </button>
        </div>
      )}

      <section className="card quick">
        <div className="quick-row">
          <div className="quick-text">
            <div className="quick-title">
              <MessageSquare size={16} /> Chat
            </div>
            <div className="quick-desc">{cfg.chat_enabled ? 'DiyaGPT is answering normally.' : 'Paused. She sees your pause message.'}</div>
          </div>
          <Switch label="Chat enabled" checked={cfg.chat_enabled} onChange={(v) => toggle('chat_enabled', v, 'chat')} />
        </div>
        <div className="quick-row">
          <div className="quick-text">
            <div className="quick-title">
              <LogIn size={16} /> Sign-in
            </div>
            <div className="quick-desc">{cfg.login_enabled ? 'New sign-ins are allowed.' : 'Nobody new can sign in.'}</div>
          </div>
          <Switch label="Sign-in enabled" checked={cfg.login_enabled} onChange={(v) => toggle('login_enabled', v, 'sign-in')} />
        </div>
        <div className="quick-row">
          <div className="quick-text">
            <div className="quick-title">
              <UserX size={16} /> Signed-in devices
            </div>
            <div className="quick-desc">
              {userSessions} DiyaGPT device{userSessions === 1 ? '' : 's'} signed in
            </div>
          </div>
          <button
            className="btn sm danger-ghost"
            disabled={!userSessions}
            onClick={async () => {
              if (!(await confirmDialog({ title: 'Sign out every device?', body: 'Everyone using DiyaGPT will need the password again.', action: 'Sign out all', danger: true }))) return;
              const r = await api.post('/api/admin/revoke-all', { role: 'user' }, A);
              toast(`Signed out ${r.revoked} device${r.revoked === 1 ? '' : 's'}`, 'success');
              reload();
            }}
          >
            Sign out all
          </button>
        </div>
      </section>

      <div className="filters">
        <div className="segmented" role="radiogroup" aria-label="Date range">
          {[7, 30].map((n) => (
            <button key={n} role="radio" aria-checked={range === n} className={range === n ? 'active' : ''} onClick={() => setRange(n)}>
              Last {n} days
            </button>
          ))}
        </div>
      </div>

      <div className="tiles">
        <Tile icon={MessageSquare} label="Messages today" value={compact(today.messages)} sub={cfg.daily_message_limit ? `of ${cfg.daily_message_limit} daily limit` : `${compact(rangeMsgs)} in ${range} days`} />
        <Tile icon={Gauge} label="Tokens today" value={compact(today.input + today.output)} sub={`${compact(today.input)} in · ${compact(today.output)} out`} />
        <Tile icon={Activity} label={`Est. cost · ${range} days`} value={money(rangeCost)} sub={`${money(costOf(today, cfg))} today`} />
        <Tile icon={LogIn} label="Last active" value={data.last_active ? ago(data.last_active) : 'Never'} sub={data.last_active ? stamp(data.last_active) : 'No activity yet'} />
      </div>

      <div className="charts">
        <section className="card">
          <h3 className="card-title">Messages per day</h3>
          <Columns days={days} value={(d) => d.messages} label={`Messages per day, last ${range} days`} format={(v) => `${v} message${v === 1 ? '' : 's'}`} />
        </section>
        <section className="card">
          <h3 className="card-title">Tokens per day</h3>
          <Columns
            days={days}
            value={(d) => d.input + d.output}
            label={`Tokens per day, last ${range} days`}
            format={(v) => `${compact(v)} tokens`}
            detail={(d) => (
              <span>
                {compact(d.input)} in · {compact(d.output)} out · {money(costOf(d, cfg))}
              </span>
            )}
          />
        </section>
      </div>
      <button className="btn ghost sm table-toggle" onClick={() => setTable((t) => !t)}>
        <Table2 size={15} /> {table ? 'Hide' : 'Show'} table
      </button>
      {table && (
        <div className="card table-card">
          <table className="ad-table num">
            <thead>
              <tr>
                <th>Day</th>
                <th>Messages</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
                <th>Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day}>
                  <td>{dayLabel(d.day)}</td>
                  <td>{d.messages}</td>
                  <td>{d.input.toLocaleString()}</td>
                  <td>{d.output.toLocaleString()}</td>
                  <td>{money(costOf(d, cfg))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="tiles small">
        <Tile label="Chats" value={compact(data.counts.chats)} />
        <Tile label="Messages stored" value={compact(data.counts.messages)} />
        <Tile label="Files stored" value={compact(data.counts.files)} sub={bytes(data.counts.bytes)} />
        <Tile label="Web searches · all time" value={compact(data.totals.web || 0)} />
      </div>

      <section className="card">
        <div className="card-head">
          <h3 className="card-title">Recent activity</h3>
          <button className="btn ghost sm" onClick={() => goto('activity')}>
            View all
          </button>
        </div>
        <ul className="events">
          {data.events.slice(0, 8).map((e) => (
            <EventRow key={e.id} e={e} />
          ))}
          {!data.events.length && <li className="ad-empty">Nothing yet.</li>}
        </ul>
      </section>
    </div>
  );
}

// ---------- activity ----------

function ActivityTab({ data, reload }) {
  const [filter, setFilter] = useState('all');
  const [older, setOlder] = useState([]);
  const [done, setDone] = useState(false);
  const all = useMemo(() => {
    const seen = new Set();
    return [...data.events, ...older].filter((e) => !seen.has(e.id) && seen.add(e.id));
  }, [data.events, older]);
  const list = filter === 'all' ? all : all.filter((e) => CATEGORY[e.type] === filter);

  const more = async () => {
    const before = all[all.length - 1]?.id;
    if (!before) return;
    const r = await api.get(`/api/admin/events?before=${before}`, A);
    if (!r.events.length) setDone(true);
    setOlder((o) => [...o, ...r.events]);
  };

  return (
    <div className="ad-stack">
      <div className="filters">
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <button
          className="btn ghost sm"
          disabled={!data.unseen}
          onClick={async () => {
            await api.post('/api/admin/events/seen', {}, A);
            reload();
          }}
        >
          Mark all read
        </button>
      </div>
      <section className="card">
        <ul className="events">
          {list.map((e) => (
            <EventRow key={e.id} e={e} />
          ))}
          {!list.length && <li className="ad-empty">No events here.</li>}
        </ul>
        {!done && all.length >= 60 && (
          <div className="load-more">
            <button className="btn ghost sm" onClick={more}>
              Load older
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- controls ----------

const FIELDS = [
  'chat_enabled', 'login_enabled', 'pause_message', 'uploads_enabled', 'web_enabled', 'code_enabled', 'model', 'max_output_tokens',
  'daily_message_limit', 'daily_token_limit', 'announcement', 'system_prompt', 'price_in', 'price_out', 'timezone',
];

function Field({ label, desc, children }) {
  return (
    <label className="ad-field">
      <span className="ad-field-label">{label}</span>
      {desc && <span className="ad-field-desc">{desc}</span>}
      {children}
    </label>
  );
}

function ToggleRow({ title, desc, checked, onChange }) {
  return (
    <div className="quick-row">
      <div className="quick-text">
        <div className="quick-title">{title}</div>
        {desc && <div className="quick-desc">{desc}</div>}
      </div>
      <Switch label={title} checked={checked} onChange={onChange} />
    </div>
  );
}

function Controls({ data, saveConfig }) {
  const pick = (cfg) => Object.fromEntries(FIELDS.map((k) => [k, cfg[k]]));
  const [form, setForm] = useState(() => pick(data.config));
  const [saving, setSaving] = useState(false);
  const base = pick(data.config);
  const dirty = FIELDS.some((k) => String(form[k]) !== String(base[k]));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k) => (e) => set(k, e.target.value === '' ? '' : Number(e.target.value));

  const save = async () => {
    setSaving(true);
    const patch = {};
    for (const k of FIELDS) if (String(form[k]) !== String(base[k])) patch[k] = form[k] === '' ? 0 : form[k];
    const ok = await saveConfig(patch);
    setSaving(false);
    if (ok) setForm(pick(ok));
  };

  return (
    <div className="ad-stack controls">
      <section className="card">
        <h3 className="card-title">Availability</h3>
        <ToggleRow title="Chat" desc="Turn off to pause DiyaGPT. She’ll see the message below." checked={form.chat_enabled} onChange={(v) => set('chat_enabled', v)} />
        <ToggleRow title="Sign-in" desc="Turn off to block new sign-ins. Signed-in devices keep working." checked={form.login_enabled} onChange={(v) => set('login_enabled', v)} />
        <Field label="Pause message">
          <input className="field" value={form.pause_message} maxLength={300} onChange={(e) => set('pause_message', e.target.value)} />
        </Field>
      </section>

      <section className="card">
        <h3 className="card-title">Features</h3>
        <ToggleRow title="File uploads" desc="Photos, PDFs, documents, spreadsheets and other files." checked={form.uploads_enabled} onChange={(v) => set('uploads_enabled', v)} />
        <ToggleRow title="Web search" desc="Lets the model search the web. Searches add cost." checked={form.web_enabled} onChange={(v) => set('web_enabled', v)} />
        <ToggleRow title="Code & analysis" desc="Lets the model run Python for math, data, charts and files." checked={form.code_enabled} onChange={(v) => set('code_enabled', v)} />
      </section>

      <section className="card">
        <h3 className="card-title">Model & limits</h3>
        <div className="grid2">
          <Field label="Azure deployment" desc="The deployment name in Foundry.">
            <input className="field" value={form.model} onChange={(e) => set('model', e.target.value.trim())} spellCheck={false} />
          </Field>
          <Field label="Max output tokens" desc="Per answer. 0 = no limit.">
            <input className="field" type="number" min={0} value={form.max_output_tokens} onChange={num('max_output_tokens')} />
          </Field>
          <Field label="Daily message limit" desc="0 = unlimited. Resets at midnight.">
            <input className="field" type="number" min={0} value={form.daily_message_limit} onChange={num('daily_message_limit')} />
          </Field>
          <Field label="Daily token limit" desc="Input + output. 0 = unlimited.">
            <input className="field" type="number" min={0} value={form.daily_token_limit} onChange={num('daily_token_limit')} />
          </Field>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Announcement</h3>
        <Field label="Banner message" desc="Shown at the top of her chat until she dismisses it. Leave empty for none.">
          <textarea className="field" rows={2} maxLength={500} value={form.announcement} onChange={(e) => set('announcement', e.target.value)} />
        </Field>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 className="card-title">Instructions</h3>
          <button className="btn ghost sm" onClick={() => set('system_prompt', data.defaults.system_prompt)} disabled={form.system_prompt === data.defaults.system_prompt}>
            <RefreshCw size={14} /> Reset to default
          </button>
        </div>
        <Field label="System prompt" desc="How DiyaGPT behaves. Her own personalization is added after this.">
          <textarea className="field mono" rows={9} maxLength={12000} value={form.system_prompt} onChange={(e) => set('system_prompt', e.target.value)} />
        </Field>
      </section>

      <section className="card">
        <h3 className="card-title">Cost estimate & time zone</h3>
        <div className="grid3">
          <Field label="Input $ / 1M tokens">
            <input className="field" type="number" min={0} step="0.01" value={form.price_in} onChange={num('price_in')} />
          </Field>
          <Field label="Output $ / 1M tokens">
            <input className="field" type="number" min={0} step="0.01" value={form.price_out} onChange={num('price_out')} />
          </Field>
          <Field label="Time zone" desc="For daily limits and charts.">
            <input className="field" value={form.timezone} onChange={(e) => set('timezone', e.target.value.trim())} spellCheck={false} />
          </Field>
        </div>
        <p className="ad-note">Match these to your Azure pricing for accurate estimates. Cached input is counted at 10%.</p>
      </section>

      <div className={`save-bar ${dirty ? 'show' : ''}`}>
        <span>Unsaved changes</span>
        <button className="btn ghost sm" onClick={() => setForm(base)} disabled={saving}>
          Discard
        </button>
        <button className="btn primary sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ---------- security ----------

function PasswordForm({ target, onDone }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [signout, setSignout] = useState(true);
  const [busy, setBusy] = useState(false);
  const mismatch = pw2 && pw !== pw2;
  const user = target === 'user';
  return (
    <form
      className="pw-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < 8 || pw !== pw2) return;
        const ok = await confirmDialog({
          title: `Change the ${user ? 'DiyaGPT' : 'admin'} password?`,
          body: user ? `She’ll need the new password${signout ? ' on every device' : ' next time she signs in'}.` : 'Use the new password next time you open the admin panel.',
          action: 'Change password',
        });
        if (!ok) return;
        setBusy(true);
        try {
          await api.post('/api/admin/password', { target, password: pw, signout }, A);
          toast('Password changed', 'success');
          setPw('');
          setPw2('');
          onDone();
        } catch (err) {
          toast(err.message, 'error');
        }
        setBusy(false);
      }}
    >
      <input className="field" type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
      <input className="field" type="password" autoComplete="new-password" placeholder="Repeat new password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      {mismatch && <span className="ad-error">Passwords don’t match.</span>}
      <label className="check">
        <input type="checkbox" checked={signout} onChange={(e) => setSignout(e.target.checked)} />
        {user ? 'Sign out all DiyaGPT devices' : 'Sign out other admin sessions'}
      </label>
      <button className="btn primary sm" type="submit" disabled={busy || pw.length < 8 || pw !== pw2}>
        Change password
      </button>
    </form>
  );
}

function Security({ data, reload }) {
  const cfg = data.config;
  const now = Date.now();
  const L = data.lock;
  const lockedFor = (a) => {
    const l = L[a.scope];
    return a.fails >= l.dayMax ? 'Locked 24 h' : a.fails >= l.tries && now - a.last < l.window ? 'Locked' : `${a.fails} wrong`;
  };
  const anyLock = cfg.user_global_lock_until > now || cfg.admin_global_lock_until > now || data.attempts.length > 0;

  return (
    <div className="ad-stack">
      <section className="card">
        <div className="card-head">
          <h3 className="card-title">Signed-in devices</h3>
          <button
            className="btn sm danger-ghost"
            disabled={!data.sessions.some((s) => s.role === 'user')}
            onClick={async () => {
              if (!(await confirmDialog({ title: 'Sign out every DiyaGPT device?', action: 'Sign out all', danger: true }))) return;
              await api.post('/api/admin/revoke-all', { role: 'user' }, A);
              reload();
            }}
          >
            Sign out all DiyaGPT devices
          </button>
        </div>
        <div className="sessions">
          {data.sessions.map((s) => (
            <div key={s.id} className="session">
              {/iPhone|Android|iPad/.test(s.device) ? <Smartphone size={18} /> : <Laptop size={18} />}
              <div className="session-text">
                <div className="session-name">
                  {s.device}
                  <span className={`role ${s.role}`}>{s.role === 'admin' ? 'Admin' : 'DiyaGPT'}</span>
                  {s.current && <span className="badge">This session</span>}
                </div>
                <div className="session-sub">
                  {s.location} · signed in {ago(s.created_at)} · active {ago(s.last_seen)}
                </div>
              </div>
              {!s.current && (
                <button
                  className="btn ghost sm"
                  onClick={async () => {
                    await api.del(`/api/admin/sessions/${s.id}`, A);
                    toast('Signed out', 'success');
                    reload();
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 className="card-title">Sign-in protection</h3>
          <button
            className="btn ghost sm"
            disabled={!anyLock}
            onClick={async () => {
              await api.post('/api/admin/unlock', {}, A);
              toast('Lockouts cleared', 'success');
              reload();
            }}
          >
            <Unlock size={14} /> Clear lockouts
          </button>
        </div>
        <ul className="rules">
          <li>
            <strong>{L.user.tries} wrong passwords</strong> from one network locks it out for {L.user.window / 60000} minutes.
          </li>
          <li>
            <strong>{L.user.dayMax} wrong in a day</strong> locks that network out for 24 hours.
          </li>
          <li>
            <strong>{L.user.global} wrong in an hour</strong> from anywhere locks sign-in for everyone for 1 hour (signed-in devices keep working).
          </li>
          <li>The password is checked only on the server, and a locked network gets no answer either way, so guessing is useless.</li>
        </ul>
        {cfg.user_global_lock_until > now && <div className="ad-alert slim">Sign-in is locked for everyone until {stamp(cfg.user_global_lock_until)}.</div>}
        {cfg.admin_global_lock_until > now && <div className="ad-alert slim">Admin sign-in is locked until {stamp(cfg.admin_global_lock_until)}.</div>}
        {data.attempts.length > 0 ? (
          <table className="ad-table">
            <thead>
              <tr>
                <th>Where</th>
                <th>For</th>
                <th>Status</th>
                <th>Last try</th>
              </tr>
            </thead>
            <tbody>
              {data.attempts.map((a) => (
                <tr key={`${a.scope}${a.ip}`}>
                  <td className="mono">{a.ip}</td>
                  <td>{a.scope === 'admin' ? 'Admin' : 'DiyaGPT'}</td>
                  <td>{lockedFor(a)}</td>
                  <td>{ago(a.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ad-note">No wrong passwords in the last 24 hours.</p>
        )}
      </section>

      <div className="grid2">
        <section className="card">
          <h3 className="card-title">DiyaGPT password</h3>
          <PasswordForm target="user" onDone={reload} />
        </section>
        <section className="card">
          <h3 className="card-title">Admin password</h3>
          <PasswordForm target="admin" onDone={reload} />
        </section>
      </div>
    </div>
  );
}

// ---------- alerts ----------

const NOTIFY = [
  ['notify_login', 'Sign-ins', 'Every time someone signs in to DiyaGPT.'],
  ['notify_failed', 'Wrong passwords', 'Each wrong password attempt.'],
  ['notify_lockout', 'Lockouts', 'When a network or all of sign-in gets locked.'],
  ['notify_limit', 'Daily limit reached', 'Once per day when a limit is hit.'],
  ['notify_error', 'Model errors', 'When Azure returns an error.'],
  ['notify_admin', 'Admin activity', 'Admin sign-ins and password changes.'],
];

function readBrowserNotify() {
  try {
    return localStorage.getItem('diyagpt.admin.notify') === '1' && 'Notification' in window && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

function Alerts({ data, saveConfig, browserNotify, setBrowserNotify }) {
  const cfg = data.config;
  const topic = cfg.ntfy_topic;
  const url = `https://ntfy.sh/${topic}`;
  return (
    <div className="ad-stack">
      <section className="card">
        <h3 className="card-title">Phone notifications</h3>
        <p className="ad-note">Free push notifications through ntfy. Keep the topic name private: anyone who knows it can read these alerts.</p>
        <ol className="steps-list">
          <li>
            Install <strong>ntfy</strong> on your phone (
            <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener noreferrer">
              iPhone
            </a>{' '}
            ·{' '}
            <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener noreferrer">
              Android
            </a>
            ), or use it in a browser.
          </li>
          <li>
            Tap <strong>+</strong> and subscribe to this topic:
            <div className="topic">
              <code>{topic || 'not set'}</code>
              <IconBtn label="Copy topic" onClick={() => copyText(topic).then(() => toast('Copied', 'success'))} disabled={!topic}>
                <Copy size={15} />
              </IconBtn>
              <a className="btn ghost sm" href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} /> Open in browser
              </a>
            </div>
          </li>
          <li>Send a test to make sure it arrives.</li>
        </ol>
        <div className="row-actions">
          <button
            className="btn primary sm"
            disabled={!topic}
            onClick={() =>
              api
                .post('/api/admin/notify-test', {}, A)
                .then(() => toast('Test sent', 'success'))
                .catch((e) => toast(e.message, 'error'))
            }
          >
            <Send size={14} /> Send test
          </button>
          <button
            className="btn ghost sm"
            onClick={async () => {
              if (!(await confirmDialog({ title: 'Make a new topic?', body: 'Your phone will stop getting alerts until you subscribe to the new topic.', action: 'New topic' }))) return;
              const fresh = `diyagpt-${[...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
              saveConfig({ ntfy_topic: fresh });
            }}
          >
            <RefreshCw size={14} /> New topic
          </button>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">What to send</h3>
        {NOTIFY.map(([key, title, desc]) => (
          <ToggleRow key={key} title={title} desc={desc} checked={cfg[key]} onChange={(v) => saveConfig({ [key]: v })} />
        ))}
      </section>

      <section className="card">
        <h3 className="card-title">This browser</h3>
        <ToggleRow
          title="Desktop notifications"
          desc="Show a notification here for new activity while the admin panel is open."
          checked={browserNotify}
          onChange={async (on) => {
            if (on) {
              if (!('Notification' in window)) return toast('This browser doesn’t support notifications.', 'error');
              const p = await Notification.requestPermission();
              if (p !== 'granted') return toast('Notifications are blocked for this site.', 'error');
            }
            try {
              localStorage.setItem('diyagpt.admin.notify', on ? '1' : '0');
            } catch {}
            setBrowserNotify(on);
          }}
        />
      </section>
    </div>
  );
}

// ---------- shell ----------

function Dashboard({ onLogout }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [browserNotify, setBrowserNotify] = useState(readBrowserNotify);
  const lastId = useRef(null);
  const notifyRef = useRef(browserNotify);
  notifyRef.current = browserNotify;

  const load = useCallback(
    () =>
      api
        .get('/api/admin/overview', A)
        .then((d) => {
          setData(d);
          setError('');
        })
        .catch((e) => e.status !== 401 && setError(e.message)),
    [],
  );

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 20_000);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const newest = data.events[0]?.id || 0;
    if (lastId.current != null && newest > lastId.current && notifyRef.current) {
      for (const e of data.events.filter((x) => x.id > lastId.current).slice(0, 3)) {
        try {
          new Notification('DiyaGPT', { body: e.message, tag: `ev-${e.id}` });
        } catch {}
      }
    }
    lastId.current = newest;
  }, [data]);

  const saveConfig = useCallback(async (patch) => {
    try {
      const r = await api.put('/api/admin/config', patch, A);
      setData((d) => ({ ...d, config: r.config }));
      toast('Saved', 'success');
      load();
      return r.config;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    }
  }, [load]);

  if (!data) return <Splash error={error} onRetry={load} />;

  return (
    <div className="admin app-enter">
      <header className="ad-top">
        <div className="ad-brand">
          <Logo size={26} className="flicker-hover" />
          <span>DiyaGPT</span>
          <span className="ad-chip">Admin</span>
        </div>
        <StatusPill cfg={data.config} />
        <div className="spacer" />
        <a className="btn ghost sm hide-sm" href="#/">
          Open DiyaGPT
        </a>
        <button
          className="bell"
          aria-label={`${data.unseen} unread events`}
          title="Activity"
          onClick={async () => {
            setTab('activity');
            if (data.unseen) {
              await api.post('/api/admin/events/seen', {}, A).catch(() => {});
              setTimeout(load, 1500);
            }
          }}
        >
          {data.unseen ? <BellRing size={18} /> : <Bell size={18} />}
          {data.unseen > 0 && <span className="bell-count">{data.unseen > 99 ? '99+' : data.unseen}</span>}
        </button>
        <IconBtn label="Sign out of admin" onClick={onLogout}>
          <LogOut size={18} />
        </IconBtn>
      </header>
      <nav className="ad-tabs" aria-label="Admin sections">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </nav>
      <main className="ad-main">
        {error && <div className="ad-alert slim">{error}</div>}
        {tab === 'overview' && <Overview data={data} saveConfig={saveConfig} reload={load} goto={setTab} />}
        {tab === 'activity' && <ActivityTab data={data} reload={load} />}
        {tab === 'controls' && <Controls key={FIELDS.map((k) => String(data.config[k])).join('|')} data={data} saveConfig={saveConfig} />}
        {tab === 'security' && <Security data={data} reload={load} />}
        {tab === 'alerts' && <Alerts data={data} saveConfig={saveConfig} browserNotify={browserNotify} setBrowserNotify={setBrowserNotify} />}
      </main>
    </div>
  );
}

export default function Admin() {
  const [token, setToken] = useState(() => tokens.get('admin'));
  useEffect(() => {
    document.title = 'DiyaGPT Admin';
    onSignedOut('admin', () => setToken(null));
    return () => {
      document.title = 'DiyaGPT';
    };
  }, []);

  const logout = async () => {
    await api.post('/api/admin/logout', {}, A).catch(() => {});
    tokens.set('admin', null);
    setToken(null);
  };

  return (
    <>
      {token ? (
        <Dashboard onLogout={logout} />
      ) : (
        <Login
          variant="admin"
          onSuccess={(t) => {
            tokens.set('admin', t);
            setToken(t);
          }}
        />
      )}
      <Dialogs />
      <Toasts />
    </>
  );
}
