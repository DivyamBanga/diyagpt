import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { appStore, useStore } from '../state/store';
import Logo from './Logo';

export function IconBtn({ label, children, className = '', active, ...rest }) {
  return (
    <button type="button" className={`icon-btn ${active ? 'active' : ''} ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Modal({ open, onClose, label, className = '', children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-root" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// A dropdown anchored to its trigger, rendered in a portal so scroll containers can't clip it.
// It flips to the other side when there isn't room. `children` receives a close() callback.
export function Menu({ trigger, children, align = 'start', side = 'bottom', className = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrap = useRef(null);
  const menu = useRef(null);

  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const r = wrap.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;
    let s = side;
    if (s === 'bottom' && r.bottom + gap + m.height > vh - 8 && r.top - gap - m.height > 8) s = 'top';
    else if (s === 'top' && r.top - gap - m.height < 8 && r.bottom + gap + m.height < vh - 8) s = 'bottom';
    const top = s === 'bottom' ? r.bottom + gap : r.top - gap - m.height;
    const left = align === 'end' ? r.right - m.width : r.left;
    setPos({
      top: Math.max(8, Math.min(top, vh - m.height - 8)),
      left: Math.max(8, Math.min(left, vw - m.width - 8)),
      from: s,
    });
  }, [open, side, align]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e) => !wrap.current?.contains(e.target) && !menu.current?.contains(e.target) && close();
    const onKey = (e) => e.key === 'Escape' && close();
    const onScroll = (e) => !menu.current?.contains(e.target) && close();
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <div className={`menu-wrap ${open ? 'open' : ''}`} ref={wrap}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open &&
        createPortal(
          <div
            ref={menu}
            className={`menu ${pos ? `ready from-${pos.from}` : ''} ${className}`}
            style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
            role="menu"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({ icon: Icon, children, danger, onClick, right, ...rest }) {
  return (
    <button type="button" role="menuitem" className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick} {...rest}>
      {Icon && <Icon size={16} />}
      <span className="menu-item-label">{children}</span>
      {right}
    </button>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span />
    </button>
  );
}

// Promise-based confirm dialog: `await confirmDialog({...})` resolves to true/false.
export function confirmDialog(opts) {
  return new Promise((resolve) => appStore.set((s) => ({ ...s, dialog: { ...opts, resolve } })));
}

// Same, with a text field: resolves to the entered string, or null when cancelled.
export function promptDialog(opts) {
  return confirmDialog({ ...opts, input: opts.value ?? '' });
}

export function Dialogs() {
  const { dialog } = useStore(appStore);
  const [value, setValue] = useState('');
  useEffect(() => {
    if (dialog) setValue(dialog.input ?? '');
  }, [dialog]);
  const prompt = dialog && dialog.input !== undefined;
  const close = (ok) => {
    dialog?.resolve(prompt ? (ok && value.trim() ? value.trim() : null) : ok);
    appStore.set((s) => ({ ...s, dialog: null }));
  };
  return (
    <Modal open={!!dialog} onClose={() => close(false)} label={dialog?.title} className="dialog">
      {dialog && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close(true);
          }}
        >
          <h2>{dialog.title}</h2>
          {dialog.body && <p>{dialog.body}</p>}
          {prompt && <input className="field" value={value} onChange={(e) => setValue(e.target.value)} autoFocus maxLength={120} onFocus={(e) => e.target.select()} />}
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={() => close(false)}>
              Cancel
            </button>
            <button type="submit" className={`btn ${dialog.danger ? 'danger' : 'primary'}`} autoFocus={!prompt}>
              {dialog.action || 'Confirm'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function Toasts() {
  const { toasts } = useStore(appStore);
  return createPortal(
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? <AlertTriangle size={16} /> : t.kind === 'success' ? <CheckCircle2 size={16} /> : <Info size={16} />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Splash({ error, onRetry, leaving }) {
  return (
    <div className={`splash ${leaving ? 'leaving' : ''}`}>
      <div className="splash-mark">
        <div className="splash-glow" />
        <Logo size={58} className="flicker" />
      </div>
      {error && (
        <div className="splash-error">
          <p>{error}</p>
          <button className="btn primary" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function CloseBtn({ onClick }) {
  return (
    <IconBtn label="Close" onClick={onClick} className="close-btn">
      <X size={18} />
    </IconBtn>
  );
}

export function useMedia(query) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const f = () => setMatch(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [query]);
  return match;
}
