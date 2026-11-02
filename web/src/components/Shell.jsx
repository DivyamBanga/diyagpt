import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import ChatView from './ChatView';
import SearchModal from './SearchModal';
import SettingsModal from './SettingsModal';
import Sidebar from './Sidebar';
import { Dialogs, IconBtn, Toasts, useMedia } from './ui';
import { downloadFile, fileUrl } from '../api';
import { appStore, loadChats, loadMe, useStore } from '../state/store';

function Lightbox({ image, onClose }) {
  const [src, setSrc] = useState(image.thumb || null);
  useEffect(() => {
    let alive = true;
    fileUrl(image.id, image.mime)
      .then((u) => alive && setSrc(u))
      .catch(() => {});
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [image.id]);
  return createPortal(
    <div className="lightbox" onClick={onClose} role="dialog" aria-label={image.name}>
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lb-name">{image.name}</span>
        <IconBtn label="Download" onClick={() => downloadFile(image.id, image.name, image.mime)}>
          <Download size={18} />
        </IconBtn>
        <IconBtn label="Close" onClick={onClose}>
          <X size={18} />
        </IconBtn>
      </div>
      {src && <img src={src} alt={image.name} onClick={(e) => e.stopPropagation()} />}
    </div>,
    document.body,
  );
}

function readSidebarPref() {
  try {
    return localStorage.getItem('diyagpt.sidebar') !== '0';
  } catch {
    return true;
  }
}

export default function Shell({ chatId, onLogout }) {
  const { prefs } = useStore(appStore);
  const mobile = useMedia('(max-width: 767px)');
  const [sidebar, setSidebar] = useState(() => !window.matchMedia('(max-width: 767px)').matches && readSidebarPref());
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [image, setImage] = useState(null);

  useEffect(() => {
    if (mobile) setSidebar(false);
    else setSidebar(readSidebarPref());
  }, [mobile]);

  const toggleSidebar = useCallback(() => {
    setSidebar((open) => {
      if (!window.matchMedia('(max-width: 767px)').matches) {
        try {
          localStorage.setItem('diyagpt.sidebar', open ? '0' : '1');
        } catch {}
      }
      return !open;
    });
  }, []);

  const newChat = useCallback(() => {
    location.hash = '#/';
    if (window.matchMedia('(max-width: 767px)').matches) setSidebar(false);
    setSearchOpen(false);
  }, []);

  // Theme and text size follow preferences (and the OS when set to "system").
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    try {
      localStorage.setItem('diyagpt.theme', prefs.theme);
    } catch {}
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs.theme]);
  useEffect(() => {
    document.documentElement.dataset.font = prefs.font;
  }, [prefs.font]);

  // Pick up admin changes (pause, announcements, revoked sessions) without a reload.
  useEffect(() => {
    const refresh = () => document.visibilityState === 'visible' && loadMe().catch(() => {});
    const sync = () => document.visibilityState === 'visible' && loadChats().catch(() => {});
    const t = setInterval(refresh, 45_000);
    const onVis = () => {
      refresh();
      sync();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'k' && !e.shiftKey) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (k === 'o' && e.shiftKey) {
        e.preventDefault();
        newChat();
      } else if (k === 's' && e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newChat, toggleSidebar]);

  const pick = (id) => {
    location.hash = `#/c/${id}`;
    setSearchOpen(false);
    if (mobile) setSidebar(false);
  };

  return (
    <div className={`shell ${sidebar ? 'sb-open' : 'sb-closed'} ${mobile ? 'mobile' : ''}`}>
      <Sidebar
        activeId={chatId}
        onNewChat={newChat}
        onSearch={() => setSearchOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onClose={toggleSidebar}
        onSelect={() => mobile && setSidebar(false)}
        onLogout={onLogout}
      />
      {mobile && sidebar && <div className="scrim" onClick={toggleSidebar} />}
      <main className="main">
        <ChatView chatId={chatId} sidebarOpen={sidebar} mobile={mobile} onToggleSidebar={toggleSidebar} onNewChat={newChat} onOpenImage={setImage} />
      </main>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onPick={pick} onNew={newChat} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onLogout={onLogout} />
      {image && <Lightbox image={image} onClose={() => setImage(null)} />}
      <Dialogs />
      <Toasts />
    </div>
  );
}
