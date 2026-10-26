import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from '../components/Toast';
import { CompatBadge, ConfirmDialog, EmptyState, ErrorBanner, Field, Icon, LoadingBlock, PageHeader, WarningList } from '../components/ui';
import type { AiPlan } from '../../shared/types';
import type { Project } from '../../shared/types';

export default function AiAssistant() {
  const { t } = useI18n();
  const toast = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<{ configured: boolean; provider: string; model: string; reason?: string; note: string; configuration: { envVars: string[]; providers: string[] } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [results, setResults] = useState<{ name: string; status: string; error?: string; warnings?: string[] }[] | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([api.aiStatus(), api.listProjects()])
      .then(([aiStatus, projectData]) => {
        setStatus(aiStatus);
        setProjects(projectData.projects);
        if (projectData.projects[0]) setProjectId(projectData.projects[0].id);
      })
      .catch((err) => setLoadError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const generate = async () => {
    if (!projectId || !prompt.trim()) return;
    setGenerating(true);
    setPlanError(null);
    setPlan(null);
    setResults(null);
    try {
      const data = await api.aiPlan(projectId, prompt.trim());
      setPlan(data.plan);
      const next: Record<string, boolean> = {};
      for (const item of data.plan.items) next[item.candidateId] = item.compatibility.level !== 'incompatible' && item.fileAvailable;
      setSelected(next);
    } catch (err) {
      setPlanError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  };

  const install = async () => {
    if (!plan || !projectId) return;
    const items = plan.items
      .filter((item) => selected[item.candidateId])
      .map((item) => ({
        libraryPluginId: item.libraryPluginId,
        modrinthProjectId: item.libraryPluginId ? null : item.candidateId.replace(/^modrinth:/, ''),
        modrinthVersionId: item.versionId,
        name: item.name,
      }));
    if (items.length === 0) return;
    setInstalling(true);
    try {
      const data = await api.aiInstall(projectId, items);
      setResults(data.results);
      setConfirmOpen(false);
      toast.success(t('toast.aiInstalled'));
      setPlan(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setInstalling(false);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;

  const selectedCount = plan ? plan.items.filter((item) => selected[item.candidateId]).length : 0;

  return (
    <div>
      <PageHeader title={t('ai.title')} subtitle={t('ai.subtitle')} />

      {!status?.configured ? (
        <div className="card mb-4 border-amber-900/50 bg-amber-950/10 p-4">
          <div className="flex items-start gap-2">
            <Icon name="sparkles" size={16} className="mt-0.5 text-amber-300" />
            <div>
              <h2 className="text-sm font-semibold text-amber-100">{t('ai.notConfigured')}</h2>
              <p className="mt-1 max-w-3xl text-xs text-amber-100/80">{t('ai.configureHint')}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {status?.configuration.envVars.map((name) => (
                  <code key={name} className="chip font-mono">
                    {name}
                  </code>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="badge badge-verified">{t('settings.aiConfigured')}</span>
          <span className="chip">
            {t('ai.provider')}: {status.provider} / {status.model}
          </span>
          <span>{status.note}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="card p-4">
          <div className="space-y-3">
            <Field label={t('project.chooseProject')}>
              <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.length === 0 ? <option value="">{t('project.noProjects')}</option> : null}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {project.mcVersion} · {project.software}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('ai.prompt')}>
              <textarea className="textarea" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('ai.placeholder')} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={generate} disabled={!status?.configured || !projectId || generating || prompt.trim().length < 8}>
                <Icon name="sparkles" size={14} /> {generating ? t('ai.generating') : t('ai.generate')}
              </button>
              <button type="button" className="btn btn-secondary btn-xs" onClick={() => setPrompt(t('ai.placeholder'))}>
                {t('common.example')}
              </button>
              {projects.length === 0 ? (
                <Link to="/projects/new" className="text-xs text-accent">
                  {t('ai.projectRequired')}
                </Link>
              ) : null}
            </div>
            {planError ? <ErrorBanner message={planError} /> : null}
          </div>
        </section>

        <aside className="card h-fit p-4 text-xs text-slate-400">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">How plans work</h3>
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>The app searches your library and Modrinth for candidates matching your request.</li>
            <li>The AI may only choose from those candidates, using real metadata.</li>
            <li>Compatibility is recalculated when you approve the plan.</li>
            <li>Nothing is downloaded or installed without your explicit approval.</li>
          </ol>
          <p className="mt-3 text-[11px] text-slate-500">
            AI output is treated as untrusted: unknown ids are dropped, incompatible plugins are skipped, and downloads always go through the backend&apos;s validated pipeline.
          </p>
        </aside>
      </div>

      {results ? (
        <section className="card mt-4 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-100">{t('templates.result')}</h2>
          <ul className="space-y-1 text-xs">
            {results.map((result) => (
              <li key={`${result.name}-${result.status}`} className="flex items-start gap-2">
                <span
                  className={`badge ${
                    result.status === 'installed' ? 'badge-verified' : result.status === 'rejected' ? 'badge-potential' : 'badge-incompatible'
                  }`}
                >
                  {result.status}
                </span>
                <span className="min-w-0">
                  <span className="text-slate-200">{result.name}</span>
                  {result.error ? <span className="block text-[11px] text-red-300">{result.error}</span> : null}
                  {result.warnings?.length ? <span className="block text-[11px] text-slate-500">{result.warnings.join(' ')}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {projectId ? (
            <Link to={`/projects/${projectId}?tab=plugins`} className="btn btn-xs btn-secondary mt-3">
              {t('project.plugins')}
            </Link>
          ) : null}
        </section>
      ) : null}

      {plan ? (
        <section className="card mt-4">
          <div className="card-header">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">{t('ai.plan')}</h2>
              <p className="text-[11px] text-slate-500">
                {plan.provider.provider} / {plan.provider.model} · {plan.candidateCount} {t('ai.candidates').toLowerCase()}
              </p>
            </div>
            <button type="button" className="btn btn-primary btn-xs" onClick={() => setConfirmOpen(true)} disabled={selectedCount === 0}>
              <Icon name="check" size={12} /> {t('ai.approve')} ({selectedCount})
            </button>
          </div>
          <div className="space-y-3 p-4">
            <p className="text-sm text-slate-300">{plan.summary}</p>
            {plan.warnings.length > 0 ? <WarningList warnings={plan.warnings} /> : null}

            {plan.items.length === 0 ? (
              <EmptyState title={t('ai.noItems')} description={plan.unresolved.join(' ') || undefined} icon="sparkles" />
            ) : (
              <div className="space-y-1.5">
                {plan.items.map((item) => (
                  <label
                    key={item.candidateId}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 ${
                      selected[item.candidateId] ? 'border-accent/40 bg-accent/5' : 'border-surface-700 bg-surface-850/40'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={Boolean(selected[item.candidateId])}
                      onChange={(e) => setSelected({ ...selected, [item.candidateId]: e.target.checked })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm text-slate-100">{item.name}</span>
                        <span className="chip">{item.source}</span>
                        <CompatBadge level={item.compatibility.level} />
                        {!item.fileAvailable ? <span className="badge badge-incompatible">no file</span> : null}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">{item.reason}</span>
                      {item.warnings.length > 0 ? <span className="mt-0.5 block text-[11px] text-amber-200/80">{item.warnings.join(' ')}</span> : null}
                      <span className="mt-0.5 block text-[10px] text-slate-600">
                        {item.category}
                        {item.versionId ? ` · version ${item.versionId}` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {plan.unresolved.length > 0 ? (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-200">{t('ai.unresolved')}</h3>
                <WarningList warnings={plan.unresolved} />
              </div>
            ) : null}
            {plan.duplicatesAvoided.length > 0 ? (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('ai.duplicates')}</h3>
                <WarningList warnings={plan.duplicatesAvoided} tone="info" />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={t('ai.approve')}
        message={t('ai.confirmInstall', { count: selectedCount })}
        confirmLabel={t('common.install')}
        busy={installing}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={install}
      >
        <p className="text-xs text-slate-500">
          Selected plugins will be added to the project. Modrinth downloads are resolved by the backend and hash-verified when possible.
        </p>
      </ConfirmDialog>
    </div>
  );
}
