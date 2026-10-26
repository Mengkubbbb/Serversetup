import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { CodeEditor } from './CodeEditor';
import { useToast, errorMessage } from './Toast';
import { useI18n } from '../i18n';
import { ConfirmDialog, EmptyState, Field, Icon, InlineError, Modal, Spinner, WarningList } from './ui';
import { UnsavedDot, formatDate } from './format';
import type { ExportPreview, ProjectConfig, ProjectPlugin } from '../../shared/types';

interface Props {
  projectId: string;
  plugins: ProjectPlugin[];
  initialConfigId?: string | null;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function ConfigPanel({ projectId, plugins, initialConfigId, onDirtyChange }: Props) {
  const { t, lang } = useI18n();
  const toast = useToast();

  const [configs, setConfigs] = useState<ProjectConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialConfigId ?? null);
  const [draft, setDraft] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [wordWrap, setWordWrap] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPath, setImportPath] = useState('');
  const [importPluginId, setImportPluginId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const textareaSearchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => configs.find((c) => c.id === selectedId) ?? null, [configs, selectedId]);
  const dirty = Boolean(selected) && draft !== selected?.content;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const loadList = async () => {
    setLoading(true);
    try {
      const data = await api.listConfigs(projectId);
      setConfigs(data.configs);
      if (!selectedId && data.configs.length > 0) setSelectedId(data.configs[0].id);
      if (selectedId && !data.configs.some((c) => c.id === selectedId)) setSelectedId(data.configs[0]?.id ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
    api
      .exportPreview(projectId)
      .then((data) => setPreview(data.preview))
      .catch(() => undefined);
  };

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!selectedId) {
      setDraft('');
      return;
    }
    setLoadingConfig(true);
    setValidation(null);
    api
      .getProject(projectId)
      .then((detail) => {
        const config = detail.configs.find((c) => c.id === selectedId);
        if (config) setDraft(config.content);
      })
      .catch((err) => toast.error(errorMessage(err)))
      .finally(() => setLoadingConfig(false));
  }, [selectedId, projectId, toast]);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await api.updateConfig(projectId, selected.id, { content: draft });
      setConfigs((prev) => prev.map((c) => (c.id === result.config.id ? result.config : c)));
      setValidation({ valid: true, errors: [], warnings: [] });
      toast.success(t('toast.configSaved'));
      const p = await api.exportPreview(projectId);
      setPreview(p.preview);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    if (!selected) return;
    try {
      const result = await api.validateConfig(projectId, { content: draft, format: selected.format });
      setValidation(result);
      toast[result.valid ? 'success' : 'error'](result.valid ? t('editor.valid') : t('editor.invalid'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const createFile = async () => {
    setNewError(null);
    if (!newPath.trim()) {
      setNewError(t('editor.filePathHint'));
      return;
    }
    try {
      const result = await api.createConfig(projectId, { path: newPath.trim(), content: newContent, format: undefined });
      setConfigs((prev) => [...prev, result.config].sort((a, b) => a.path.localeCompare(b.path)));
      setSelectedId(result.config.id);
      setDraft(result.config.content);
      setNewFileOpen(false);
      setNewPath('');
      setNewContent('');
      toast.success(t('editor.saved'));
      const p = await api.exportPreview(projectId);
      setPreview(p.preview);
    } catch (err) {
      setNewError(errorMessage(err));
    }
  };

  const importFileNow = async () => {
    if (!importFile) {
      toast.error('Choose a file to import.');
      return;
    }
    const form = new FormData();
    form.append('file', importFile);
    if (importPath.trim()) form.append('path', importPath.trim());
    if (importPluginId) form.append('pluginId', importPluginId);
    try {
      const result = await api.importConfig(projectId, form);
      setConfigs((prev) => [...prev.filter((c) => c.id !== result.config.id), result.config].sort((a, b) => a.path.localeCompare(b.path)));
      setSelectedId(result.config.id);
      setImportOpen(false);
      setImportFile(null);
      setImportPath('');
      setImportPluginId('');
      toast.success(t('toast.uploaded'));
      const p = await api.exportPreview(projectId);
      setPreview(p.preview);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const removeFile = async () => {
    if (!selected) return;
    try {
      await api.deleteConfig(projectId, selected.id);
      setConfirmDelete(false);
      toast.success(t('toast.configDeleted'));
      setSelectedId(null);
      await loadList();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const resetFile = async () => {
    if (!selected) return;
    try {
      const result = await api.resetConfig(projectId, selected.id);
      setDraft(result.config.content);
      setConfirmReset(false);
      setConfigs((prev) => prev.map((c) => (c.id === result.config.id ? result.config : c)));
      toast.success(t('editor.templateLoaded'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const findInFile = () => {
    if (!searchTerm) return;
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Configuration content"]');
    if (!textarea) return;
    const index = draft.toLowerCase().indexOf(searchTerm.toLowerCase(), textarea.selectionEnd);
    const finalIndex = index === -1 ? draft.toLowerCase().indexOf(searchTerm.toLowerCase()) : index;
    if (finalIndex === -1) {
      toast.info(t('common.noResults'));
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(finalIndex, finalIndex + searchTerm.length);
    const ratio = finalIndex / Math.max(draft.length, 1);
    textarea.scrollTop = ratio * textarea.scrollHeight;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="card flex h-fit flex-col">
        <div className="card-header">
          <h3 className="text-sm font-semibold text-slate-200">{t('editor.files')}</h3>
          <div className="flex gap-1">
            <button type="button" className="btn btn-xs btn-secondary" onClick={() => setNewFileOpen(true)}>
              <Icon name="plus" size={12} />
            </button>
            <button type="button" className="btn btn-xs btn-secondary" onClick={() => setImportOpen(true)} title={t('editor.importFile')}>
              <Icon name="upload" size={12} />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="p-4">
            <Spinner label={t('common.loading')} />
          </div>
        ) : configs.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">{t('editor.noFiles')}</p>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto py-1">
            {configs.map((config) => (
              <li key={config.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(config.id)}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-850 ${
                    selectedId === config.id ? 'bg-surface-850 text-slate-100' : 'text-slate-400'
                  }`}
                >
                  <Icon name="file" size={13} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono">{config.path}</span>
                    <span className="block text-[10px] text-slate-500">
                      {config.format} · {formatDate(config.updatedAt, lang)}
                    </span>
                  </span>
                  {selectedId === config.id && dirty ? <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-400" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <div className="p-3">
            <InlineError message={error} />
          </div>
        ) : null}
        <div className="border-t border-surface-800 p-3 text-[11px] text-slate-500">
          {t('editor.previewNote')}
          {preview ? (
            <div className="mt-1 text-slate-400">
              {preview.fileCount} files · {(preview.totalBytes / 1024).toFixed(0)} KB
              {preview.errors.length > 0 ? <span className="ml-1 text-red-300">({preview.errors.length} errors)</span> : null}
            </div>
          ) : null}
        </div>
      </aside>

      <section className="min-w-0 space-y-3">
        {!selected ? (
          <div className="card p-6">
            <EmptyState title={t('editor.selectFile')} description={t('editor.previewNote')} icon="file" />
          </div>
        ) : (
          <>
            <div className="card">
              <div className="flex flex-wrap items-center gap-2 border-b border-surface-700 px-3 py-2">
                <span className="font-mono text-xs text-slate-300">{selected.path}</span>
                <span className="chip">{selected.format}</span>
                {dirty ? (
                  <span className="badge badge-potential">
                    <UnsavedDot show /> {t('editor.unsaved')}
                  </span>
                ) : (
                  <span className="badge badge-verified">{t('common.saved')}</span>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-1">
                  <div className="relative">
                    <input
                      ref={textareaSearchRef}
                      className="input h-7 w-36 py-1 text-xs"
                      placeholder={t('editor.searchInFile')}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') findInFile();
                      }}
                    />
                  </div>
                  <button type="button" className="btn btn-xs btn-ghost" onClick={findInFile} title={t('editor.searchInFile')}>
                    <Icon name="search" size={12} />
                  </button>
                  <button type="button" className={`btn btn-xs ${wordWrap ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setWordWrap((w) => !w)}>
                    {t('editor.wordWrap')}
                  </button>
                  <button type="button" className="btn btn-xs btn-secondary" onClick={validate}>
                    <Icon name="shield" size={12} /> {t('editor.validate')}
                  </button>
                  <button type="button" className="btn btn-xs btn-secondary" onClick={() => setConfirmReset(true)}>
                    <Icon name="refresh" size={12} /> {t('editor.reset')}
                  </button>
                  <a className="btn btn-xs btn-secondary" href={`/api/projects/${projectId}/configs/${selected.id}/download`}>
                    <Icon name="download" size={12} />
                  </a>
                  <button type="button" className="btn btn-xs btn-danger" onClick={() => setConfirmDelete(true)}>
                    <Icon name="trash" size={12} />
                  </button>
                  <button type="button" className="btn btn-xs btn-primary" onClick={save} disabled={!dirty || saving}>
                    {saving ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </div>
              <div className="p-3">
                {loadingConfig ? (
                  <Spinner label={t('common.loading')} />
                ) : (
                  <CodeEditor value={draft} onChange={setDraft} format={selected.format} wordWrap={wordWrap} fileName={selected.path} />
                )}
                {validation ? (
                  <div className="mt-2 space-y-2">
                    {!validation.valid ? <WarningList warnings={validation.errors} tone="error" /> : <p className="text-xs text-emerald-300">{t('editor.valid')}</p>}
                    {validation.warnings.length > 0 ? <WarningList warnings={validation.warnings} /> : null}
                  </div>
                ) : null}
              </div>
            </div>
            {preview ? (
              <div className="card p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('editor.includedInZip')}</h4>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-slate-400">
                  {preview.entries.map((entry) => (
                    <li key={entry.path} className="flex justify-between gap-2 font-mono">
                      <span className={entry.path === `plugins/${selected.path}` ? 'text-accent' : ''}>{entry.path}</span>
                      <span className="text-slate-600">{(entry.size / 1024).toFixed(1)} KB</span>
                    </li>
                  ))}
                </ul>
                {preview.errors.length > 0 ? (
                  <div className="mt-2">
                    <WarningList warnings={preview.errors} tone="error" />
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>

      <Modal
        open={newFileOpen}
        title={t('editor.newFileTitle')}
        onClose={() => setNewFileOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setNewFileOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={createFile}>
              {t('common.create')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('editor.filePath')} hint={t('editor.filePathHint')}>
            <input className="input" value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="TAB/config.yml" />
          </Field>
          <Field label={t('common.description')} hint={t('common.optional')}>
            <textarea className="textarea code-font" rows={8} value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="# new configuration" />
          </Field>
          <InlineError message={newError} />
        </div>
      </Modal>

      <Modal
        open={importOpen}
        title={t('editor.importFile')}
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={importFileNow}>
              {t('common.upload')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('common.file')}>
            <input
              type="file"
              className="input file:mr-3 file:rounded file:border-0 file:bg-surface-700 file:px-2 file:py-1 file:text-xs file:text-slate-200"
              accept=".yml,.yaml,.json,.toml,.txt,.conf,.properties"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field label={`${t('editor.filePath')} (${t('common.optional')})`} hint="Leave empty to place the file in the selected plugin folder.">
            <input className="input" value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="PluginName/config.yml" />
          </Field>
          <Field label={`${t('project.plugins')} (${t('common.optional')})`}>
            <select className="select" value={importPluginId} onChange={(e) => setImportPluginId(e.target.value)}>
              <option value="">—</option>
              {plugins.map((plugin) => (
                <option key={plugin.id} value={plugin.id}>
                  {plugin.displayName} ({plugin.configDir})
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-slate-500">Imported files are validated for their format before they are saved.</p>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title={t('editor.delete')}
        message={t('editor.deleteConfirm', { path: selected?.path ?? '' })}
        danger
        confirmLabel={t('common.delete')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={removeFile}
      />

      <ConfirmDialog
        open={confirmReset}
        title={t('editor.reset')}
        message={t('editor.resetConfirm')}
        confirmLabel={t('editor.reset')}
        onCancel={() => setConfirmReset(false)}
        onConfirm={resetFile}
      />
    </div>
  );
}
