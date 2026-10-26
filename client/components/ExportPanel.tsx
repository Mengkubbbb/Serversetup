import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from './Toast';
import { EmptyState, Icon, LoadingBlock, Spinner, Toggle, WarningList } from './ui';
import { formatBytes } from './format';
import type { ExportPreview } from '../../shared/types';

export default function ExportPanel({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [includeTemplates, setIncludeTemplates] = useState(true);
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .exportPreview(projectId, includeTemplates)
      .then((data) => setPreview(data.preview))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [projectId, includeTemplates]);

  const download = () => {
    if (!preview || preview.errors.length > 0) return;
    const anchor = document.createElement('a');
    anchor.href = api.exportUrl(projectId, includeTemplates);
    anchor.download = preview.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    toast.success(t('project.exportSuccess'));
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">{t('project.exportPreview')}</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              The archive contains only <span className="font-mono text-slate-300">plugins/</span> — no server JAR, worlds, logs, server.properties, database or environment files.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-xs" onClick={load}>
              <Icon name="refresh" size={12} /> {t('common.refresh')}
            </button>
            <button type="button" className="btn btn-primary btn-xs" onClick={download} disabled={!preview || preview.errors.length > 0}>
              <Icon name="download" size={12} /> {t('project.exportZip')}
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-surface-700 bg-surface-850/50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{t('common.file')}</div>
            <div className="text-sm text-slate-200">{preview?.fileName ?? `${projectName}-Setup.zip`}</div>
          </div>
          <div className="rounded-md border border-surface-700 bg-surface-850/50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Files</div>
            <div className="text-sm text-slate-200">{preview?.fileCount ?? 0}</div>
          </div>
          <div className="rounded-md border border-surface-700 bg-surface-850/50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{t('common.size')}</div>
            <div className="text-sm text-slate-200">{formatBytes(preview?.totalBytes ?? 0)}</div>
          </div>
        </div>

        <div className="mt-3">
          <Toggle
            checked={includeTemplates}
            onChange={setIncludeTemplates}
            label={t('project.includeTemplates')}
            description="Template-origin configuration files can be excluded if you only want hand-edited configs."
          />
        </div>

        {preview && preview.errors.length > 0 ? (
          <div className="mt-3">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-300">{t('project.exportErrors')}</h4>
            <WarningList warnings={preview.errors} tone="error" />
          </div>
        ) : null}
        {preview && preview.warnings.length > 0 ? (
          <div className="mt-3">
            <WarningList warnings={preview.warnings} tone="info" />
          </div>
        ) : null}
      </div>

      <div className="card overflow-hidden">
        <div className="card-header">
          <h3 className="text-sm font-semibold text-slate-200">Archive contents</h3>
          <span className="text-xs text-slate-500">plugins/</span>
        </div>
        {preview && preview.entries.length > 0 ? (
          <table className="w-full text-xs">
            <thead className="border-b border-surface-700 bg-surface-850/50">
              <tr>
                <th className="table-head px-3 py-1.5">Path</th>
                <th className="table-head px-3 py-1.5">{t('common.source')}</th>
                <th className="table-head px-3 py-1.5 text-right">{t('common.size')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {preview.entries.map((entry) => (
                <tr key={entry.path}>
                  <td className="px-3 py-1.5 font-mono text-slate-300">{entry.path}</td>
                  <td className="px-3 py-1.5 text-slate-500">{entry.plugin}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{formatBytes(entry.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4">
            <EmptyState title="Nothing to export yet" description="Add plugins or configuration files first." icon="download" />
          </div>
        )}
        {preview && preview.collisions.length > 0 ? (
          <div className="border-t border-surface-800 p-3">
            <WarningList warnings={preview.collisions.map((c) => `Collision at ${c.path} (${c.from.join(', ')})`)} tone="error" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
