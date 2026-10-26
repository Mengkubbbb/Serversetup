import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ConfirmDialog, EmptyState, ErrorBanner, Icon, LinkButton, LoadingBlock, PageHeader } from '../components/ui';
import { formatBytes, formatDate } from '../components/format';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from '../components/Toast';
import type { Project } from '../../shared/types';

export default function Projects() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .listProjects()
      .then((data) => setProjects(data.projects))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const duplicate = async (project: Project) => {
    try {
      const result = await api.duplicateProject(project.id);
      toast.success(t('toast.projectDuplicated'));
      navigate(`/projects/${result.project.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await api.deleteProject(pendingDelete.id);
      toast.success(t('toast.projectDeleted'));
      setPendingDelete(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.projects')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <LinkButton to="/projects/new" variant="primary">
            <Icon name="plus" size={14} /> {t('nav.newProject')}
          </LinkButton>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {loading ? (
        <LoadingBlock label={t('common.loading')} />
      ) : projects.length === 0 ? (
        <EmptyState
          title={t('project.noProjects')}
          description={t('dashboard.step1')}
          icon="folder"
          action={
            <LinkButton to="/projects/new" variant="primary">
              {t('dashboard.newProject')}
            </LinkButton>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-surface-700 bg-surface-850/50">
              <tr>
                <th className="table-head px-4 py-2">{t('common.name')}</th>
                <th className="table-head px-4 py-2">{t('wizard.mcVersion')}</th>
                <th className="table-head px-4 py-2">{t('wizard.software')}</th>
                <th className="table-head px-4 py-2">{t('project.plugins')}</th>
                <th className="table-head px-4 py-2">{t('common.language')}</th>
                <th className="table-head px-4 py-2">{t('project.updated')}</th>
                <th className="table-head px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {projects.map((project) => (
                <tr key={project.id} className="hover:bg-surface-850/40">
                  <td className="px-4 py-2.5">
                    <Link to={`/projects/${project.id}`} className="flex items-center gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded border border-surface-700 bg-surface-850 text-[10px] text-slate-400">
                        {project.icon ? <img src={project.icon} alt="" className="h-full w-full object-cover" /> : project.serverName.slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <span className="block font-medium text-slate-100">{project.name}</span>
                        <span className="block text-xs text-slate-500">{project.serverName}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="chip">{project.mcVersion}</span>
                  </td>
                  <td className="px-4 py-2.5 capitalize text-slate-300">{project.software}</td>
                  <td className="px-4 py-2.5 text-slate-300">
                    {project.pluginCount ?? 0}
                    {project.missingPluginCount ? <span className="ml-2 badge badge-incompatible">{project.missingPluginCount} {t('common.missing')}</span> : null}
                  </td>
                  <td className="px-4 py-2.5 uppercase text-slate-400">{project.language}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(project.updatedAt, lang)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Link to={`/projects/${project.id}`} className="btn btn-xs btn-secondary">
                        {t('common.open')}
                      </Link>
                      <button type="button" className="btn btn-xs btn-ghost" onClick={() => duplicate(project)} title={t('project.duplicateProject')}>
                        <Icon name="copy" size={13} />
                      </button>
                      <button type="button" className="btn btn-xs btn-ghost text-red-300 hover:bg-red-950/40" onClick={() => setPendingDelete(project)} title={t('project.deleteProject')}>
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t('project.deleteProject')}
        message={t('project.deleteConfirm', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
}
