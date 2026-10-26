import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type ProjectDetail } from '../api';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from '../components/Toast';
import {
  CompatBadge,
  ConfirmDialog,
  ErrorBanner,
  Field,
  Icon,
  KeyValue,
  LoadingBlock,
  Modal,
  PageHeader,
  Tabs,
  WarningList,
} from '../components/ui';
import { formatDate, timeAgo } from '../components/format';
import PluginManager from '../components/PluginManager';
import ConfigPanel from '../components/ConfigPanel';
import ExportPanel from '../components/ExportPanel';
import TabEditor from '../components/TabEditor';
import LuckPermsPanel from '../components/LuckPermsPanel';
import TemplateApplyDialog from '../components/TemplateApplyDialog';
import type { ServerSoftware } from '../../shared/types';

const TABS = [
  { id: 'overview', key: 'project.overview' },
  { id: 'plugins', key: 'project.plugins' },
  { id: 'configs', key: 'project.configs' },
  { id: 'tab', key: 'project.tab' },
  { id: 'luckperms', key: 'project.luckperms' },
  { id: 'export', key: 'project.export' },
  { id: 'settings', key: 'project.settings' },
] as const;

export default function Workspace() {
  const { id = '' } = useParams();
  const { t, lang, setLang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateApplyOpen, setTemplateApplyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirtyConfig, setDirtyConfig] = useState(false);
  const [form, setForm] = useState({ name: '', serverName: '', description: '', language: 'en' as 'en' | 'th' });
  const [serverForm, setServerForm] = useState({ mcVersion: '', software: 'paper' as ServerSoftware, softwareBuild: '' });
  const [formSaved, setFormSaved] = useState(false);
  const [templateModal, setTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');

  const tab = (searchParams.get('tab') ?? 'overview') as (typeof TABS)[number]['id'];
  const templateParam = searchParams.get('template');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProject(id);
      setDetail(data);
      setForm({ name: data.project.name, serverName: data.project.serverName, description: data.project.description, language: data.project.language });
      setServerForm({ mcVersion: data.project.mcVersion, software: data.project.software, softwareBuild: data.project.softwareBuild ?? '' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (templateParam && detail && detail.project.id) {
      setTemplateApplyOpen(true);
    }
  }, [templateParam, detail]);

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const saveProject = async () => {
    try {
      await api.updateProject(id, form);
      setLang(form.language);
      setFormSaved(true);
      window.setTimeout(() => setFormSaved(false), 2000);
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const saveServer = async () => {
    try {
      const result = await api.updateProject(id, {
        mcVersion: serverForm.mcVersion.trim(),
        software: serverForm.software,
        softwareBuild: serverForm.softwareBuild.trim() || null,
      });
      toast.success(t('common.saved'));
      if (result.project.versionVerified === false) {
        toast.info(`Minecraft ${result.project.mcVersion} is a custom/unverified version.`);
      }
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const deleteProject = async () => {
    setBusy(true);
    try {
      await api.deleteProject(id);
      toast.success(t('toast.projectDeleted'));
      navigate('/projects');
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  const createTemplate = async () => {
    try {
      await api.templateFromProject(id, templateName.trim() || `${detail?.project.name} setup`);
      setTemplateModal(false);
      setTemplateName('');
      toast.success(t('toast.templateApplied'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const compatibilitySummary = useMemo(() => detail?.summary.compatibility, [detail]);

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error || !detail) return <ErrorBanner message={error ?? t('error.generic')} onRetry={load} />;

  const { project, plugins, configs, summary, dependencies } = detail;

  return (
    <div>
      <PageHeader
        title={project.name}
        subtitle={`${project.serverName} · ${project.mcVersion} · ${project.software}`}
        actions={
          <>
            <Link to="/projects" className="btn btn-xs btn-ghost">
              <Icon name="folder" size={13} /> {t('nav.projects')}
            </Link>
            <button type="button" className="btn btn-xs btn-secondary" onClick={() => setTab('plugins')}>
              <Icon name="plus" size={13} /> {t('project.addPlugins')}
            </button>
            <button type="button" className="btn btn-primary btn-xs" onClick={() => setTab('export')}>
              <Icon name="download" size={13} /> {t('project.exportZip')}
            </button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className={`badge ${project.versionVerified ? 'badge-verified' : 'badge-unknown'}`}>
          {project.mcVersion} {project.versionVerified ? '✓' : '(custom)'}
        </span>
        <span className="chip">{project.software}{project.softwareBuild ? ` #${project.softwareBuild}` : ''}</span>
        <span className="chip">{project.language.toUpperCase()}</span>
        <span className="chip">{plugins.length} plugins</span>
        {compatibilitySummary ? <CompatBadge level={compatibilitySummary.level} /> : null}
        {summary.missingFiles.length > 0 ? <span className="badge badge-incompatible">{summary.missingFiles.length} {t('common.missing')}</span> : null}
        <span className="ml-auto text-[11px] text-slate-500" title={formatDate(project.updatedAt, lang)}>
          {t('project.updated')} {timeAgo(project.updatedAt)}
        </span>
      </div>

      <Tabs
        tabs={TABS.map((item) => ({
          id: item.id,
          label: t(item.key),
          count: item.id === 'plugins' ? plugins.length : item.id === 'configs' ? configs.length : undefined,
        }))}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4">
        {tab === 'overview' ? (
          <div className="grid gap-3 lg:grid-cols-3">
            <section className="card p-4 lg:col-span-2">
              <h3 className="mb-2 text-sm font-semibold text-slate-200">Project information</h3>
              <KeyValue
                items={[
                  { label: t('wizard.projectName'), value: project.name },
                  { label: t('wizard.serverName'), value: project.serverName },
                  { label: t('wizard.mcVersion'), value: project.mcVersion },
                  { label: t('wizard.software'), value: `${project.software}${project.softwareBuild ? ` #${project.softwareBuild}` : ''}` },
                  { label: t('wizard.language'), value: project.language === 'th' ? 'ไทย' : 'English' },
                  { label: t('wizard.setupTemplate'), value: project.templateName ?? t('wizard.noTemplate') },
                  { label: t('project.installedPlugins'), value: plugins.length },
                  { label: t('project.updated'), value: formatDate(project.updatedAt, lang) },
                ]}
              />
              {project.description ? <p className="mt-3 rounded-md border border-surface-700 bg-surface-850/40 p-2.5 text-sm text-slate-300">{project.description}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-xs btn-secondary" onClick={() => setTab('plugins')}>
                  {t('project.addPlugins')}
                </button>
                <button type="button" className="btn btn-xs btn-secondary" onClick={() => setTab('configs')}>
                  {t('project.openConfig')}
                </button>
                <button type="button" className="btn btn-xs btn-secondary" onClick={() => setTemplateApplyOpen(true)}>
                  {t('project.applyTemplate')}
                </button>
                <button type="button" className="btn btn-xs btn-secondary" onClick={() => setTemplateModal(true)}>
                  {t('templates.fromProject')}
                </button>
              </div>
            </section>

            <section className="card p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-200">{t('project.compatibilityWarnings')}</h3>
              {summary.warnings.length === 0 ? (
                <p className="text-xs text-emerald-300">{t('project.noDependencyIssues')}</p>
              ) : (
                <ul className="space-y-2">
                  {summary.warnings.map((warning) => (
                    <li key={warning.plugin} className="rounded-md border border-surface-700 bg-surface-850/40 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-200">{warning.plugin}</span>
                        <CompatBadge level={warning.level} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{warning.reasons.join(' ')}</p>
                    </li>
                  ))}
                </ul>
              )}
              {summary.dependencyIssues.length > 0 ? (
                <div className="mt-3">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-200">{t('project.dependencies')}</h4>
                  <ul className="space-y-1 text-[11px] text-amber-100">
                    {summary.dependencyIssues.map((dep, index) => (
                      <li key={index}>
                        {t('project.missingDependency')}: <span className="font-mono">{dep.name}</span> ({dep.forPlugin})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {project.templateId ? (
                <div className="mt-3 rounded-md border border-accent/30 bg-accent/5 p-2">
                  <p className="text-[11px] text-slate-300">
                    {t('wizard.setupTemplate')}: <span className="text-slate-100">{project.templateName}</span>
                  </p>
                  <button type="button" className="btn btn-xs btn-secondary mt-1.5" onClick={() => setTemplateApplyOpen(true)}>
                    {t('templates.preview')}
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {tab === 'plugins' ? (
          <PluginManager
            project={project}
            plugins={plugins}
            dependencies={dependencies}
            onChanged={load}
            autoTemplateId={templateParam}
            onTemplateHandled={() => {
              const params = new URLSearchParams(searchParams);
              params.delete('template');
              params.set('tab', 'plugins');
              setSearchParams(params, { replace: true });
            }}
          />
        ) : null}

        {tab === 'configs' ? (
          <div className="space-y-2">
            {dirtyConfig ? <WarningList warnings={[t('editor.unsavedHint')]} /> : null}
            <ConfigPanel projectId={project.id} plugins={plugins} initialConfigId={searchParams.get('config')} onDirtyChange={setDirtyConfig} />
          </div>
        ) : null}

        {tab === 'tab' ? <TabEditor projectId={project.id} /> : null}
        {tab === 'luckperms' ? <LuckPermsPanel project={project} plugins={plugins} onChanged={load} /> : null}
        {tab === 'export' ? <ExportPanel projectId={project.id} projectName={project.serverName} /> : null}

        {tab === 'settings' ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-200">Project details</h3>
              <div className="space-y-3">
                <Field label={t('wizard.projectName')}>
                  <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label={t('wizard.serverName')}>
                  <input className="input" value={form.serverName} onChange={(e) => setForm({ ...form, serverName: e.target.value })} />
                </Field>
                <Field label={t('wizard.description')}>
                  <textarea className="textarea" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </Field>
                <Field label={t('wizard.language')}>
                  <select className="select" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as 'en' | 'th' })}>
                    <option value="en">English</option>
                    <option value="th">ไทย</option>
                  </select>
                </Field>
                <div className="flex justify-end">
                  <button type="button" className="btn btn-primary btn-sm text-sm" onClick={saveProject}>
                    {formSaved ? t('common.saved') : t('common.save')}
                  </button>
                </div>
              </div>
            </section>

            <section className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-200">{t('project.serverSettings')}</h3>
              <div className="space-y-3">
                <Field label={t('wizard.mcVersion')} hint="Changing the version re-evaluates plugin compatibility.">
                  <input className="input" value={serverForm.mcVersion} onChange={(e) => setServerForm({ ...serverForm, mcVersion: e.target.value })} />
                </Field>
                <Field label={t('wizard.software')}>
                  <select className="select" value={serverForm.software} onChange={(e) => setServerForm({ ...serverForm, software: e.target.value as ServerSoftware })}>
                    <option value="paper">Paper</option>
                    <option value="folia">Folia</option>
                    <option value="leaf">Leaf</option>
                  </select>
                </Field>
                <Field label={`${t('wizard.build')} (${t('common.optional')})`}>
                  <input className="input" value={serverForm.softwareBuild} onChange={(e) => setServerForm({ ...serverForm, softwareBuild: e.target.value })} />
                </Field>
                <p className="text-xs text-slate-500">
                  {serverForm.software === 'folia'
                    ? t('wizard.foliaNote')
                    : serverForm.software === 'leaf'
                      ? t('wizard.leafNote')
                      : t('wizard.paperNote')}
                </p>
                <div className="flex justify-end">
                  <button type="button" className="btn btn-primary text-sm" onClick={saveServer}>
                    {t('common.save')}
                  </button>
                </div>
              </div>
            </section>

            <section className="card p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-200">{t('templates.fromProject')}</h3>
              <p className="text-xs text-slate-400">Capture the current plugin list as a reusable setup template.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn btn-secondary btn-xs" onClick={() => setTemplateModal(true)}>
                  {t('templates.create')}
                </button>
              </div>
            </section>

            <section className="card border-red-900/40 p-4">
              <h3 className="mb-2 text-sm font-semibold text-red-200">{t('project.deleteProject')}</h3>
              <p className="text-xs text-slate-400">Deleting removes this project and its configuration files. Cached plugin files stay in the shared library.</p>
              <button type="button" className="btn btn-danger btn-xs mt-2" onClick={() => setDeleteOpen(true)}>
                {t('project.deleteProject')}
              </button>
            </section>
          </div>
        ) : null}
      </div>

      <TemplateApplyDialog
        open={templateApplyOpen}
        onClose={() => {
          setTemplateApplyOpen(false);
          const params = new URLSearchParams(searchParams);
          params.delete('template');
          setSearchParams(params, { replace: true });
        }}
        projects={[project]}
        projectId={project.id}
        initialTemplateId={project.templateId ?? templateParam ?? undefined}
        onApplied={load}
      />

      <Modal
        open={templateModal}
        title={t('templates.fromProject')}
        onClose={() => setTemplateModal(false)}
        width="max-w-md"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setTemplateModal(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={createTemplate}>
              {t('common.create')}
            </button>
          </>
        }
      >
        <Field label={t('common.name')}>
          <input className="input" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder={`${project.name} setup`} />
        </Field>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title={t('project.deleteProject')}
        message={t('project.deleteConfirm', { name: project.name })}
        danger
        busy={busy}
        confirmLabel={t('common.delete')}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={deleteProject}
      />
    </div>
  );
}
