import { memo, useMemo, useState } from 'react';
import { ChevronsUpDown, Ellipsis, LogOut, Monitor, Moon, PanelLeft, Pencil, Pin, PinOff, Search, Settings, SquarePen, Sun, Trash2 } from 'lucide-react';
import Logo from './Logo';
import { IconBtn, Menu, MenuItem, confirmDialog } from './ui';
import { appStore, chatStore, deleteChat, listStore, pinChat, renameChat, savePrefs, useStore } from '../state/store';
import { groupChats, isTouch } from '../lib/util';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const ChatItem = memo(function ChatItem({ c, active, onSelect }) {
  const { streaming } = useStore(chatStore(c.id));
  const [renaming, setRenaming] = useState(false);

  const save = (value) => {
    setRenaming(false);
    const t = value.trim();
    if (t && t !== c.title) renameChat(c.id, t);
  };

  return (
    <div className={`sb-item ${active ? 'active' : ''}`}>
      {renaming ? (
        <input
          className="sb-rename"
          defaultValue={c.title}
          autoFocus
          maxLength={120}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => save(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <a href={`#/c/${c.id}`} className="sb-link" onClick={onSelect} title={c.title}>
          <span className="sb-title">{c.title}</span>
          {streaming && <span className="sb-live" aria-label="Answering" />}
        </a>
      )}
      {!renaming && (
        <Menu
          align="end"
          trigger={({ toggle, open }) => (
            <IconBtn label="Chat options" className={`sb-more ${open ? 'open' : ''}`} onClick={toggle}>
              <Ellipsis size={16} />
            </IconBtn>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={c.pinned ? PinOff : Pin} onClick={() => (close(), pinChat(c.id, !c.pinned))}>
                {c.pinned ? 'Unpin' : 'Pin'}
              </MenuItem>
              <MenuItem icon={Pencil} onClick={() => (close(), setRenaming(true))}>
                Rename
              </MenuItem>
              <MenuItem
                icon={Trash2}
                danger
                onClick={async () => {
                  close();
                  const ok = await confirmDialog({ title: 'Delete chat?', body: `“${c.title}” and its files will be permanently deleted.`, action: 'Delete', danger: true });
                  if (!ok) return;
                  await deleteChat(c.id);
                  if (active) location.replace('#/');
                }}
              >
                Delete
              </MenuItem>
            </>
          )}
        </Menu>
      )}
    </div>
  );
});

const THEMES = [
  { id: 'system', icon: Monitor, label: 'System' },
  { id: 'light', icon: Sun, label: 'Light' },
  { id: 'dark', icon: Moon, label: 'Dark' },
];

export default function Sidebar({ activeId, onNewChat, onSearch, onSettings, onClose, onSelect, onLogout }) {
  const { chats, loaded } = useStore(listStore);
  const { prefs } = useStore(appStore);
  const groups = useMemo(() => groupChats(chats), [chats]);
  const touch = isTouch();
  const name = prefs?.name || 'You';

  return (
    <aside className="sidebar" aria-label="Chats">
      <div className="sb-head">
        <a
          className="sb-brand"
          href="#/"
          onClick={(e) => {
            e.preventDefault();
            onNewChat();
          }}
        >
          <Logo size={26} className="flicker-hover" />
          <span>DiyaGPT</span>
        </a>
        <IconBtn label="Close sidebar" onClick={onClose}>
          <PanelLeft size={19} />
        </IconBtn>
      </div>

      <nav className="sb-actions">
        <button type="button" className="sb-btn" onClick={onNewChat}>
          <SquarePen size={17} />
          <span>New chat</span>
          {!touch && <kbd>{MOD}⇧O</kbd>}
        </button>
        <button type="button" className="sb-btn" onClick={onSearch}>
          <Search size={17} />
          <span>Search chats</span>
          {!touch && <kbd>{MOD}K</kbd>}
        </button>
      </nav>

      <div className="sb-list">
        {loaded && !chats.length && <p className="sb-empty">Your chats will show up here.</p>}
        {groups.map(([label, items]) => (
          <section key={label}>
            <h3>{label}</h3>
            {items.map((c) => (
              <ChatItem key={c.id} c={c} active={c.id === activeId} onSelect={onSelect} />
            ))}
          </section>
        ))}
      </div>

      <div className="sb-foot">
        <Menu
          side="top"
          trigger={({ toggle, open }) => (
            <button type="button" className={`sb-user ${open ? 'open' : ''}`} onClick={toggle}>
              <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
              <span className="sb-user-name">{name}</span>
              <ChevronsUpDown size={15} />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="menu-themes" role="group" aria-label="Theme">
                {THEMES.map((t) => (
                  <button key={t.id} type="button" className={prefs?.theme === t.id ? 'active' : ''} onClick={() => savePrefs({ theme: t.id })} title={t.label}>
                    <t.icon size={15} />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
              <div className="menu-sep" />
              <MenuItem icon={Settings} onClick={() => (close(), onSettings())}>
                Settings
              </MenuItem>
              <MenuItem icon={LogOut} onClick={() => (close(), onLogout())}>
                Log out
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </aside>
  );
}
