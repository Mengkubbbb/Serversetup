import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SettingsPayload } from '../api';
import { EmptyState, ErrorBanner, Icon, LinkButton, LoadingBlock, PageHeader, StatCard } from '../components/ui';
import { formatDate } from '../components/format';
import { useI18n } from '../i18n';
import type { Project, ServerTemplate } from '../../shared/types';

export default function Dashboard() {
  const { t, lang } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<ServerTemplate[]>([]);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [libraryCount, setLibraryCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([api.listProjects(), api.templates(), api.settings(), api.library({ limit: 1 })])
      .then(([projectData, templateData, settingsData, libraryData]) => {
        setProjects(projectData.projects);
        setTemplates(templateData.templates);
        setSettings(settingsData);
        setLibraryCount(libraryData.total);
      })
      .catch((err) => setError(err.message ?? t('error.generic')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;

  const recent = projects.slice(0, 5);

  return (
    <div>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <>
            <LinkButton to="/library" variant="secondary">
              <Icon name="package" size={14} /> {t('nav.library')}
            </LinkButton>
            <LinkButton to="/projects/new" variant="primary">
              <Icon name="plus" size={14} /> {t('dashboard.newProject')}
            </LinkButton>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('dashboard.projects')} value={projects.length} hint={`${projects.reduce((sum, p) => sum + (p.pluginCount ?? 0), 0)} plugins total`} icon="folder" />
        <StatCard label={t('dashboard.library')} value={libraryCount ?? 0} hint="Shared local cache" icon="package" />
        <StatCard label={t('dashboard.templates')} value={templates.length} hint={`${templates.filter((tpl) => tpl.builtin).length} built-in`} icon="layers" />
        <div className="card p-4">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wide">{t('dashboard.aiStatus')}</span>
            <Icon name="sparkles" size={15} />
          </div>
          <div className={`mt-2 text-sm font-medium ${settings?.ai.configured ? 'text-emerald-300' : 'text-slate-300'}`}>
            {settings?.ai.configured ? t('dashboard.aiReady') : t('dashboard.aiMissing')}
          </div>
          <Link to="/ai" className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:text-accent-soft">
            {t('nav.ai')} <Icon name="arrowRight" size={12} />
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-slate-200">{t('dashboard.recent')}</h2>
            <Link to="/projects" className="text-xs text-slate-400 hover:text-slate-200">
              {t('nav.projects')} →
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={t('dashboard.recentEmpty')}
                description={t('dashboard.step1')}
                action={
                  <LinkButton to="/projects/new" variant="primary">
                    {t('dashboard.newProject')}
                  </LinkButton>
                }
                icon="folder"
              />
            </div>
          ) : (
            <ul className="divide-y divide-surface-800">
              {recent.map((project) => (
                <li key={project.id}>
                  <Link to={`/projects/${project.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-850/60">
                    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded border border-surface-700 bg-surface-850 text-[11px] font-semibold text-slate-400">
                      {project.icon ? <img src={project.icon} alt="" className="h-full w-full object-cover" /> : project.serverName.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">{project.name}</span>
                        <span className="chip">{project.software}</span>
                        <span className="chip">{project.mcVersion}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {project.pluginCount ?? 0} plugins · {t('project.updated')} {formatDate(project.updatedAt, lang)}
                      </div>
                    </div>
                    {project.missingPluginCount ? <span className="badge badge-incompatible">{project.missingPluginCount} {t('common.missing')}</span> : null}
                    <Icon name="chevron" size={14} className="text-slate-600" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-slate-200">{t('dashboard.getStarted')}</h2>
          </div>
          <ol className="space-y-3 p-4 text-sm text-slate-300">
            {[t('dashboard.step1'), t('dashboard.step2'), t('dashboard.step3')].map((step, index) => (
              <li key={index} className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-surface-600 text-[11px] text-slate-400">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="border-t border-surface-800 p-4">
            <Link to="/templates" className="flex items-center justify-between text-sm text-slate-300 hover:text-slate-100">
              {t('nav.templates')} <Icon name="arrowRight" size={14} />
            </Link>
            <Link to="/editor" className="mt-2 flex items-center justify-between text-sm text-slate-300 hover:text-slate-100">
              {t('nav.editor')} <Icon name="arrowRight" size={14} />
            </Link>
          </div>
        </section>
      </div>

      {settings ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span className="chip">{settings.ai.configured ? `${settings.ai.provider} / ${settings.ai.model}` : 'AI: none'}</span>
          <span className="chip">Modrinth: live API</span>
          <span className="chip">PaperMC Fill v3</span>
          <span className="chip">Export: plugins/ only</span>
        </div>
      ) : null}
    </div>
  );
}
