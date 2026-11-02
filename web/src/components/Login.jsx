import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock } from 'lucide-react';
import { api } from '../api';
import Logo from './Logo';

function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function Embers() {
  const embers = useMemo(
    () =>
      Array.from({ length: 16 }, () => ({
        left: `${8 + Math.random() * 84}%`,
        size: `${1.5 + Math.random() * 2.5}px`,
        delay: `${-Math.random() * 14}s`,
        dur: `${10 + Math.random() * 9}s`,
        drift: `${(Math.random() - 0.5) * 80}px`,
      })),
    [],
  );
  return (
    <div className="embers" aria-hidden="true">
      {embers.map((e, i) => (
        <span key={i} style={{ left: e.left, width: e.size, height: e.size, animationDelay: e.delay, animationDuration: e.dur, '--drift': e.drift }} />
      ))}
    </div>
  );
}

export default function Login({ variant = 'user', onSuccess, notice = '' }) {
  const admin = variant === 'admin';
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | checking | success
  const [status, setStatus] = useState({ remaining: 5, max: 5, locked_until: 0, login_enabled: true });
  const [error, setError] = useState(notice);
  const [shaking, setShaking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const input = useRef(null);

  const locked = status.locked_until > now;

  const refresh = () =>
    api
      .get(`/api/status?scope=${variant}`, { role: variant })
      .then(setStatus)
      .catch(() => {});

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!status.locked_until) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= status.locked_until) {
        clearInterval(t);
        setError('');
        refresh();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [status.locked_until]);

  useEffect(() => {
    if (!locked && phase === 'idle') input.current?.focus();
  }, [locked, phase]);

  async function submit(e) {
    e.preventDefault();
    if (!pw || phase !== 'idle' || locked) return;
    setPhase('checking');
    setError('');
    try {
      const r = await api.post(admin ? '/api/admin/login' : '/api/login', { password: pw }, { role: variant });
      setPhase('success');
      setTimeout(() => onSuccess(r.token), 1250);
    } catch (err) {
      setPhase('idle');
      setPw('');
      setShaking(true);
      const b = err.body || {};
      if (err.code === 'locked') {
        setStatus((s) => ({ ...s, remaining: 0, locked_until: b.locked_until }));
        setNow(Date.now());
      } else if (err.code === 'invalid') {
        setStatus((s) => ({ ...s, remaining: b.remaining }));
        setError(b.remaining === 1 ? 'That’s not it. One try left before sign-in locks.' : 'That’s not it. Try again.');
      } else setError(err.message);
      setTimeout(() => input.current?.focus(), 0);
    }
  }

  const disabled = !status.login_enabled;
  const sub = admin ? 'Admin console' : 'Welcome back. Enter your password to continue.';
  const message = locked
    ? `Too many tries. Sign-in unlocks in ${countdown(status.locked_until - now)}.`
    : disabled
      ? 'Sign-in is turned off right now.'
      : error;

  return (
    <div className={`login phase-${phase} ${locked ? 'is-locked' : ''}`}>
      <div className="login-glow" aria-hidden="true" />
      <div className="login-grain" aria-hidden="true" />
      <Embers />

      <main className="login-card">
        <div className="login-mark">
          <div className="login-halo" aria-hidden="true" />
          <Logo size={88} className="flicker" />
        </div>
        <h1 className="login-title">
          DiyaGPT
          {admin && <span className="login-chip">Admin</span>}
        </h1>
        <p className="login-sub">{sub}</p>

        <div className="login-form-wrap">
        <form
          className={`login-form ${shaking ? 'shake' : ''}`}
          onSubmit={submit}
          onAnimationEnd={() => setShaking(false)}
          autoComplete="on"
        >
          <input className="sr-only" type="text" name="username" autoComplete="username" value={admin ? 'admin' : 'diya'} readOnly tabIndex={-1} aria-hidden="true" />
          <label className="sr-only" htmlFor="pw">Password</label>
          <input
            ref={input}
            id="pw"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={locked || disabled || phase !== 'idle'}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            maxLength={200}
          />
          <button type="button" className="login-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} tabIndex={-1}>
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
          <button type="submit" className="login-go" disabled={!pw || locked || disabled || phase !== 'idle'} aria-label="Sign in">
            {phase === 'checking' ? <span className="login-spin" /> : <ArrowRight size={19} />}
          </button>
        </form>
        </div>

        <div className="login-tries" role="img" aria-label={`${status.remaining} of ${status.max} tries left`}>
          {Array.from({ length: status.max }, (_, i) => (
            <span key={i} className={`try ${i < status.remaining ? 'lit' : 'out'}`} style={{ animationDelay: `${i * 0.37}s` }} />
          ))}
        </div>
        <p className="login-msg" role="alert" aria-live="polite">
          {message}
        </p>
      </main>

      <footer className="login-foot">
        <Lock size={12} /> Private · {status.max} tries, then sign-in locks
      </footer>
      <div className="login-reveal" aria-hidden="true" />
    </div>
  );
}
