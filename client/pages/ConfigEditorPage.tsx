import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type ProjectDetail } from '../api';
import { useI18n } from '../i18n';
import { errorMessage } from '../components/Toast';
import { EmptyState, ErrorBanner, Field, Icon, LoadingBlock, PageHeader } from '../components/ui';
import ConfigPanel from '../components/ConfigPanel';
import type { Project } from '../../shared/types';

export default function ConfigEditorPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const projectId = searchParams.get('project') ?? '';
  const configId = searchParams.get('config');

  useEffect(() => {
    api
      .listProjects()
      .then((data) => {
        setProjects(data.projects);
        if (!projectId && data.projects[0]) {
          const params = new URLSearchParams(searchParams);
          params.set('project', data.projects[0].id);
          setSearchParams(params, { replace: true });
        }
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getProject(projectId)
      .then(setDetail)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorBanner message={error} />;
  if (projects.length === 0) {
    return (
      <div>
        <PageHeader title={t('editor.title')} subtitle={t('editor.subtitle')} />
        <EmptyState
          title={t('project.noProjects')}
          description={t('dashboard.step1')}
          icon="folder"
          action={
            <Link to="/projects/new" className="btn btn-primary">
              {t('dashboard.newProject')}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('editor.title')}
        subtitle={t('editor.subtitle')}
        actions={
          <select
            className="select max-w-[280px] text-xs"
            value={projectId}
            onChange={(event) => {
              const params = new URLSearchParams();
              params.set('project', event.target.value);
              setSearchParams(params, { replace: true });
            }}
            aria-label={t('project.chooseProject')}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.mcVersion} · {project.software}
              </option>
            ))}
          </select>
        }
      />

      {detail ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Link to={`/projects/${detail.project.id}`} className="chip hover:border-accent/60 hover:text-slate-200">
              <Icon name="arrowRight" size={10} /> {detail.project.name}
            </Link>
            <span className="chip">{detail.project.mcVersion}</span>
            <span className="chip">{detail.project.software}</span>
            <span className="chip">{detail.configs.length} files</span>
            <Link to={`/projects/${detail.project.id}?tab=tab`} className="chip hover:border-accent/60 hover:text-slate-200">
              {t('project.tab')}
            </Link>
          </div>
          <ConfigPanel projectId={detail.project.id} plugins={detail.plugins} initialConfigId={configId} />
        </div>
      ) : (
        <EmptyState title={t('editor.selectFile')} icon="file" />
      )}
    </div>
  );
}
