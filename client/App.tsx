import React, { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Icon, type IconName } from './components/ui';
import { useI18n, type TKey } from './i18n';
import { api } from './api';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Wizard from './pages/Wizard';
import Workspace from './pages/Workspace';
import PluginLibrary from './pages/PluginLibrary';
import Templates from './pages/Templates';
import AiAssistant from './pages/AiAssistant';
import ConfigEditorPage from './pages/ConfigEditorPage';
import Settings from './pages/Settings';

interface NavItem {
  to: string;
  key: TKey;
  icon: IconName;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', key: 'nav.dashboard', icon: 'dashboard', end: true },
  { to: '/projects', key: 'nav.projects', icon: 'folder' },
  { to: '/library', key: 'nav.library', icon: 'package' },
  { to: '/templates', key: 'nav.templates', icon: 'layers' },
  { to: '/ai', key: 'nav.ai', icon: 'sparkles' },
  { to: '/editor', key: 'nav.editor', icon: 'sliders' },
  { to: '/settings', key: 'nav.settings', icon: 'settings' },
];

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.title = `${t('app.name')} — ${t('app.tagline')}`;
  }, [t]);

  useEffect(() => {
    api
      .aiStatus()
      .then((status) => setAiConfigured(status.configured))
      .catch(() => setAiConfigured(false));
  }, []);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="grid h-8 w-8 place-items-center rounded-md border border-accent/30 bg-accent/10 text-accent">
          <Icon name="package" size={17} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{t('app.name')}</div>
          <div className="truncate text-[11px] text-slate-500">{t('app.tagline')}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => `navlink ${isActive ? 'navlink-active' : ''}`}
          >
            <Icon name={item.icon} size={16} />
            <span className="truncate">{t(item.key)}</span>
          </NavLink>
        ))}
      </nav>
      <div className="space-y-2 border-t border-surface-800 p-3">
        <div className="flex items-center justify-between rounded-md border border-surface-700 bg-surface-850/60 px-2.5 py-1.5 text-[11px]">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className={`h-1.5 w-1.5 rounded-full ${aiConfigured ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            AI
          </span>
          <span className={aiConfigured ? 'text-emerald-300' : 'text-slate-500'}>
            {aiConfigured === null ? '…' : aiConfigured ? t('settings.aiConfigured') : t('settings.aiMissing')}
          </span>
        </div>
        <div className="flex rounded-md border border-surface-700 bg-surface-850 p-0.5 text-[11px]">
          {(['en', 'th'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              className={`flex-1 rounded px-2 py-1 transition-colors ${lang === code ? 'bg-surface-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {code === 'en' ? 'English' : 'ไทย'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-surface-800 bg-surface-900/70 md:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="fade-in absolute inset-y-0 left-0 w-64 border-r border-surface-800 bg-surface-900">{sidebar}</aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-surface-800 bg-surface-950/80 px-4 py-2.5 backdrop-blur">
          <button
            type="button"
            className="btn btn-ghost btn-xs md:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Icon name="dashboard" size={16} />
          </button>
          <span className="text-xs text-slate-500">
            {t('app.name')} <span className="mx-1 text-surface-600">/</span>{' '}
            <span className="text-slate-400">{t('app.tagline')}</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <NavLink to="/projects/new" className="btn btn-primary btn-xs">
              <Icon name="plus" size={13} />
              <span className="hidden sm:inline">{t('nav.newProject')}</span>
            </NavLink>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/new" element={<Wizard />} />
            <Route path="/projects/:id" element={<Workspace />} />
            <Route path="/library" element={<PluginLibrary />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/ai" element={<AiAssistant />} />
            <Route path="/editor" element={<ConfigEditorPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="card p-8 text-center">
      <h1 className="text-lg font-semibold text-slate-100">404</h1>
      <p className="mt-1 text-sm text-slate-400">{t('common.noResults')}</p>
      <NavLink to="/" className="btn btn-secondary mt-4 inline-flex">
        {t('nav.dashboard')}
      </NavLink>
    </div>
  );
}
