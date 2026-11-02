import { Suspense, lazy, useEffect, useState } from 'react';
import Login from './components/Login';
import Shell from './components/Shell';
import { Splash } from './components/ui';
import { api, onSignedOut, tokens } from './api';
import { appStore, listStore, loadChats, loadMe } from './state/store';

const Admin = lazy(() => import('./admin/Admin'));

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'admin' || h.startsWith('admin/')) return { admin: true };
  const m = /^c\/([A-Za-z0-9_-]{6,64})/.exec(h);
  return { chatId: m ? m[1] : null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function UserApp({ chatId }) {
  const [stage, setStage] = useState(() => (tokens.get('user') ? 'boot' : 'login')); // login | boot | ready
  const [notice, setNotice] = useState('');
  const [bootError, setBootError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    onSignedOut('user', () => {
      setNotice('You were signed out. Please sign in again.');
      setStage('login');
    });
  }, []);

  useEffect(() => {
    if (stage !== 'boot') return;
    let alive = true;
    setBootError('');
    setLeaving(false);
    Promise.all([loadMe(), loadChats(), sleep(650)])
      .then(async () => {
        if (!alive) return;
        setLeaving(true);
        await sleep(380);
        if (alive) setStage('ready');
      })
      .catch((e) => {
        if (alive && e.status !== 401) setBootError(e.message || 'Couldn’t load DiyaGPT.');
      });
    return () => {
      alive = false;
    };
  }, [stage, attempt]);

  const logout = async () => {
    await api.post('/api/logout').catch(() => {});
    tokens.set('user', null);
    appStore.set((s) => ({ ...s, prefs: null, features: null }));
    listStore.set({ chats: [], loaded: false });
    setNotice('');
    location.replace('#/');
    setStage('login');
  };

  if (stage === 'login')
    return (
      <Login
        notice={notice}
        onSuccess={(token) => {
          tokens.set('user', token);
          setNotice('');
          setStage('boot');
        }}
      />
    );
  if (stage === 'boot') return <Splash error={bootError} leaving={leaving} onRetry={() => setAttempt((a) => a + 1)} />;
  return (
    <div className="app-enter">
      <Shell chatId={chatId} onLogout={logout} />
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const f = () => setRoute(parseHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  if (route.admin)
    return (
      <Suspense fallback={<Splash />}>
        <Admin />
      </Suspense>
    );
  return <UserApp chatId={route.chatId} />;
}
