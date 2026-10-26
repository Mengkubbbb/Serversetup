import React, { useEffect, useMemo, useState } from 'react';
import { api, type TemplatePreviewPayload } from '../api';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from './Toast';
import { CompatBadge, ErrorBanner, Field, Icon, InlineError, Modal, Spinner, WarningList } from './ui';
import type { Project } from '../../shared/types';

const STATUS_BADGES: Record<string, string> = {
  'available-local': 'badge badge-verified',
  'available-modrinth': 'badge badge-potential',
  'in-project': 'badge badge-unknown',
  unavailable: 'badge badge-incompatible',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void | Promise<void>;
  projects: Project[];
  projectId?: string;
  initialTemplateId?: string;
}

export default function TemplateApplyDialog({ open, onClose, onApplied, projects, projectId, initialTemplateId }: Props) {
  const { t } = useI18n();
  const toast = useToast();

  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? projects[0]?.id ?? '');
  const [templateId, setTemplateId] = useState(initialTemplateId ?? '');
  const [templates, setTemplates] = useState<{ id: string; name: string; plugins: unknown[] }[]>([]);
  const [preview, setPreview] = useState<TemplatePreviewPayload | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installMissing, setInstallMissing] = useState(false);
  const [overwriteConfigs, setOverwriteConfigs] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ added: { name: string }[]; skipped: { name: string; reason: string }[]; failed: { name: string; reason: string }[]; warnings: string[] } | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);

  const project = useMemo(() => projects.find((p) => p.id === selectedProjectId), [projects, selectedProjectId]);

  useEffect(() => {
    if (!open) return;
    setSelectedProjectId(projectId ?? projects[0]?.id ?? '');
    setTemplateId(initialTemplateId ?? '');
    setResult(null);
    setError(null);
    setLoadingTemplates(true);
    api
      .templates()
      .then((data) => {
        setTemplates(data.templates);
        if (!initialTemplateId && data.templates[0]) setTemplateId(data.templates[0].id);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoadingTemplates(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTemplateId]);

  useEffect(() => {
    if (!open || !templateId) return;
    setLoadingPreview(true);
    setError(null);
    api
      .templatePreview(templateId, selectedProjectId || undefined)
      .then((data) => setPreview(data.preview))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoadingPreview(false));
  }, [open, templateId, selectedProjectId]);

  const apply = async () => {
    if (!templateId || !selectedProjectId) return;
    setApplying(true);
    setError(null);
    try {
      const applied = await api.applyTemplate(templateId, {
        projectId: selectedProjectId,
        installMissing,
        overwriteConfigs,
      });
      setResult(applied);
      setConfirmApply(false);
      toast.success(t('toast.templateApplied'));
      await onApplied?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setApplying(false);
    }
  };

  const needsDownload = preview?.plugins.filter((p) => p.status === 'available-modrinth').length ?? 0;
  const willAdd = preview?.plugins.filter((p) => p.status === 'available-local' || p.status === 'available-modrinth').length ?? 0;
  const unavailable = preview?.plugins.filter((p) => p.status === 'unavailable').length ?? 0;

  return (
    <Modal
      open={open}
      title={`${t('templates.apply')} — ${preview?.template.name ?? ''}`}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        result ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!templateId || !selectedProjectId || applying || loadingPreview || willAdd === 0}
              onClick={() => setConfirmApply(true)}
            >
              {applying ? t('common.loading') : t('templates.apply')}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">{t('templates.result')}</h3>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded border border-emerald-900/50 bg-emerald-950/30 p-2">
              <div className="text-lg text-emerald-300">{result.added.length}</div>
              {t('common.installed')}
            </div>
            <div className="rounded border border-surface-700 bg-surface-850 p-2">
              <div className="text-lg text-slate-300">{result.skipped.length}</div>
              {t('common.none')}
            </div>
            <div className="rounded border border-red-900/50 bg-red-950/30 p-2">
              <div className="text-lg text-red-300">{result.failed.length}</div>
              {t('common.errors')}
            </div>
          </div>
          {result.added.length > 0 ? (
            <ul className="text-xs text-slate-300">
              {result.added.map((item) => (
                <li key={item.name} className="flex items-center gap-1.5">
                  <Icon name="check" size={12} className="text-emerald-400" /> {item.name}
                </li>
              ))}
            </ul>
          ) : null}
          {result.skipped.length > 0 ? <WarningList warnings={result.skipped.map((s) => `${s.name}: ${s.reason}`)} /> : null}
          {result.failed.length > 0 ? <WarningList warnings={result.failed.map((f) => `${f.name}: ${f.reason}`)} tone="error" /> : null}
          {result.warnings.length > 0 ? <WarningList warnings={result.warnings} /> : null}
        </div>
      ) : (
        <div className="space-y-3">
          {error ? <ErrorBanner message={error} /> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('project.chooseProject')}>
              <select className="select" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} disabled={Boolean(projectId)}>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.mcVersion} · {item.software}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('templates.title')}>
              <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={Boolean(initialTemplateId)}>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {project ? (
            <p className="rounded-md border border-surface-700 bg-surface-850/50 px-2.5 py-1.5 text-[11px] text-slate-400">
              Target: <span className="text-slate-200">{project.serverName}</span> · Minecraft {project.mcVersion} · {project.software}. Nothing is downloaded until you confirm.
            </p>
          ) : null}

          {loadingTemplates || loadingPreview ? (
            <Spinner label={t('common.loading')} />
          ) : preview ? (
            <>
              <p className="text-xs text-slate-400">{preview.template.description}</p>
              <div className="rounded-md border border-surface-700">
                <table className="w-full text-xs">
                  <thead className="border-b border-surface-700 bg-surface-850/60">
                    <tr>
                      <th className="table-head px-2 py-1.5">{t('common.name')}</th>
                      <th className="table-head px-2 py-1.5">{t('common.status')}</th>
                      <th className="table-head px-2 py-1.5">{t('common.compatibility')}</th>
                      <th className="table-head px-2 py-1.5">{t('common.version')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-800">
                    {preview.plugins.map((entry) => (
                      <tr key={entry.ref.name}>
                        <td className="px-2 py-1.5">
                          <span className="text-slate-200">{entry.ref.name}</span>
                          {entry.ref.required ? <span className="ml-1 text-red-300">*</span> : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={STATUS_BADGES[entry.status]}>{t(`templates.status.${entry.status}` as any)}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <CompatBadge level={entry.compatibility.level} />
                        </td>
                        <td className="px-2 py-1.5 text-slate-500">{entry.version ?? '—'}</td>
                      </tr>
                    ))}
                    {preview.plugins.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-slate-500">
                          {t('templates.noTemplates')}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-2 text-[11px] text-slate-400 sm:grid-cols-3">
                <div className="rounded border border-surface-700 bg-surface-850/40 px-2 py-1.5">
                  {willAdd} plugins will be added
                </div>
                <div className="rounded border border-surface-700 bg-surface-850/40 px-2 py-1.5">
                  {needsDownload} need a Modrinth download
                </div>
                <div className="rounded border border-surface-700 bg-surface-850/40 px-2 py-1.5">
                  {unavailable} unavailable
                </div>
              </div>

              <label className="flex items-start gap-2 text-xs text-slate-300">
                <input type="checkbox" className="mt-0.5" checked={installMissing} onChange={(e) => setInstallMissing(e.target.checked)} />
                <span>
                  {t('templates.downloadMissing')}
                  <span className="block text-[11px] text-slate-500">Only Modrinth project references stored in the template are used; URLs are resolved and validated by the backend.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs text-slate-300">
                <input type="checkbox" className="mt-0.5" checked={overwriteConfigs} onChange={(e) => setOverwriteConfigs(e.target.checked)} />
                <span>
                  {t('templates.overwriteConfigs')}
                  <span className="block text-[11px] text-slate-500">When disabled, existing configuration files are preserved.</span>
                </span>
              </label>

              {preview.warnings.length > 0 ? <WarningList warnings={preview.warnings} /> : null}
              {preview.template.notes ? <p className="text-xs text-slate-400">{preview.template.notes}</p> : null}
              {willAdd === 0 ? <InlineError message="No plugins can be added: download the missing plugins or upload them to the library first." /> : null}
            </>
          ) : (
            <InlineError message="Select a template to see its plugin list." />
          )}
        </div>
      )}

      <Modal
        open={confirmApply}
        title={t('templates.apply')}
        onClose={() => setConfirmApply(false)}
        width="max-w-md"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmApply(false)} disabled={applying}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={apply} disabled={applying}>
              {applying ? t('common.loading') : t('common.confirm')}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Add {willAdd} plugin(s) to “{project?.name}”?
          {installMissing && needsDownload > 0 ? ` ${needsDownload} plugin(s) will be downloaded from Modrinth.` : ''}
        </p>
        {reportsOverwrite(overwriteConfigs) ? <p className="mt-2 text-xs text-amber-200">Existing configuration files may be overwritten.</p> : null}
      </Modal>
    </Modal>
  );
}

function reportsOverwrite(value: boolean): boolean {
  return value;
}
