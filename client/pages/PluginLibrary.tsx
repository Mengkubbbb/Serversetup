import React, { useEffect, useMemo, useState } from 'react';
import { api, type CategoryInfo, type ModrinthHit, type ModrinthVersion } from '../api';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from '../components/Toast';
import {
  CompatBadge,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  Field,
  Icon,
  LoadingBlock,
  Modal,
  PageHeader,
  SearchInput,
  Spinner,
  WarningList,
} from '../components/ui';
import { formatBytes, formatDate } from '../components/format';
import type { LibraryPlugin } from '../../shared/types';

interface UploadForm {
  kind: 'jar' | 'template';
  name: string;
  version: string;
  author: string;
  description: string;
  categories: string[];
  mcVersions: string;
  loaders: string;
  notes: string;
  projectUrl: string;
  configDir: string;
}

const EMPTY_FORM: UploadForm = {
  kind: 'jar',
  name: '',
  version: '',
  author: '',
  description: '',
  categories: ['Other'],
  mcVersions: '',
  loaders: 'paper,spigot,bukkit',
  notes: '',
  projectUrl: '',
  configDir: '',
};

export default function PluginLibrary() {
  const { t, lang } = useI18n();
  const toast = useToast();

  const [items, setItems] = useState<LibraryPlugin[]>([]);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [source, setSource] = useState<'all' | 'local' | 'modrinth'>('all');
  const [total, setTotal] = useState(0);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState<UploadForm>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{ plugin: LibraryPlugin; files?: string[]; inspection?: Record<string, unknown>; kind: string } | null>(null);

  const [editTarget, setEditTarget] = useState<LibraryPlugin | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<LibraryPlugin | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [templateTarget, setTemplateTarget] = useState<LibraryPlugin | null>(null);
  const [templateFiles, setTemplateFiles] = useState<string[]>([]);
  const [templateContent, setTemplateContent] = useState<{ path: string; content: string } | null>(null);

  const [attachTo, setAttachTo] = useState('');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  const [modrinthOpen, setModrinthOpen] = useState(false);
  const [modrinthQuery, setModrinthQuery] = useState('');
  const [hits, setHits] = useState<ModrinthHit[]>([]);
  const [loadingHits, setLoadingHits] = useState(false);
  const [hitsError, setHitsError] = useState<string | null>(null);
  const [versionTarget, setVersionTarget] = useState<ModrinthHit | null>(null);
  const [versions, setVersions] = useState<ModrinthVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .library({ q: query, category, source, limit: 100 })
      .then((data) => {
        setItems(data.items);
        setCategories(data.categories);
        setTotal(data.total);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category, source]);

  const searchModrinth = () => {
    setLoadingHits(true);
    setHitsError(null);
    api
      .modrinthSearch({ q: modrinthQuery, limit: 20 })
      .then((data) => setHits(data.hits))
      .catch((err) => setHitsError(errorMessage(err)))
      .finally(() => setLoadingHits(false));
  };

  useEffect(() => {
    if (!modrinthOpen) return;
    const timer = window.setTimeout(searchModrinth, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modrinthQuery, modrinthOpen]);

  const openVersions = async (hit: ModrinthHit) => {
    setVersionTarget(hit);
    setVersions([]);
    setSelectedVersion('');
    setLoadingVersions(true);
    try {
      const data = await api.modrinthVersions(hit.id);
      setVersions(data.versions);
      if (data.versions[0]) setSelectedVersion(data.versions[0].id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoadingVersions(false);
    }
  };

  const upload = async () => {
    if (!file) {
      setUploadError('Choose a file to upload.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    const body = new FormData();
    body.append('file', file);
    body.append('kind', form.kind);
    body.append('name', form.name);
    body.append('version', form.version);
    body.append('author', form.author);
    body.append('description', form.description);
    body.append('categories', JSON.stringify(form.categories));
    body.append('mcVersions', form.mcVersions);
    body.append('loaders', form.loaders);
    body.append('notes', form.notes);
    body.append('projectUrl', form.projectUrl);
    body.append('configDir', form.configDir);
    if (form.kind === 'template' && attachTo) body.append('linkToPluginId', attachTo);
    try {
      const result = await api.uploadPlugin(body);
      setUploadResult(result as any);
      toast.success(t('library.uploadSuccess'));
      setUploadOpen(false);
      setForm(EMPTY_FORM);
      setFile(null);
      setAttachTo('');
      load();
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setBusy(true);
    try {
      await api.libraryUpdate(editTarget.id, {
        name: editForm.name,
        version: editForm.version,
        author: editForm.author,
        description: editForm.description,
        categories: editForm.categories.split(',').map((c) => c.trim()).filter(Boolean),
        mcVersions: editForm.mcVersions.split(',').map((v) => v.trim()).filter(Boolean),
        loaders: editForm.loaders.split(',').map((v) => v.trim()).filter(Boolean),
        notes: editForm.notes,
        projectUrl: editForm.projectUrl,
      });
      setEditTarget(null);
      toast.success(t('common.saved'));
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.libraryDelete(deleteTarget.id, forceDelete);
      setDeleteTarget(null);
      setForceDelete(false);
      toast.success(t('common.delete'));
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async () => {
    try {
      const data = await api.addCategory(newCategory.trim());
      setCategories(data.categories);
      setNewCategory('');
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const showTemplate = async (plugin: LibraryPlugin) => {
    setTemplateTarget(plugin);
    setTemplateContent(null);
    try {
      const data = await fetch(`/api/plugins/library/${plugin.id}/template-files`).then((r) => r.json());
      setTemplateFiles((data.files ?? []) as string[]);
    } catch {
      setTemplateFiles([]);
    }
  };

  const downloadToLibrary = async () => {
    if (!versionTarget || !selectedVersion) return;
    setDownloading(true);
    try {
      const result = await api.downloadModrinth({ modrinthProjectId: versionTarget.id, modrinthVersionId: selectedVersion });
      toast.success(result.cached ? t('library.cached') : t('library.downloadToLibrary'));
      if (result.warnings.length > 0) toast.info(result.warnings[0]);
      setVersionTarget(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  const scan = useMemo(() => hits.length, [hits]);

  return (
    <div>
      <PageHeader
        title={t('library.title')}
        subtitle={t('library.subtitle')}
        actions={
          <>
            <button type="button" className="btn btn-secondary btn-xs" onClick={() => setCategoryOpen(true)}>
              <Icon name="layers" size={13} /> {t('library.categories')}
            </button>
            <button type="button" className="btn btn-secondary btn-xs" onClick={() => setModrinthOpen(true)}>
              <Icon name="sparkles" size={13} /> {t('library.searchModrinth')}
            </button>
            <button type="button" className="btn btn-primary btn-xs" onClick={() => setUploadOpen(true)}>
              <Icon name="upload" size={13} /> {t('library.upload')}
            </button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder={t('library.searchPlaceholder')} />
        </div>
        <select className="select max-w-[220px] text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">{t('common.all')} {t('common.categories').toLowerCase()}</option>
          {categories.map((cat) => (
            <option key={cat.name} value={cat.name}>
              {cat.name} ({cat.count})
            </option>
          ))}
        </select>
        <select className="select max-w-[160px] text-xs" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          <option value="all">{t('library.allSources')}</option>
          <option value="local">{t('library.sourceLocal')}</option>
          <option value="modrinth">{t('library.sourceModrinth')}</option>
        </select>
        <span className="text-xs text-slate-500">{total} entries</span>
      </div>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {loading ? (
        <LoadingBlock label={t('common.loading')} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('common.noResults')}
          description={t('library.fileHint')}
          icon="package"
          action={
            <button type="button" className="btn btn-primary btn-xs" onClick={() => setUploadOpen(true)}>
              {t('library.upload')}
            </button>
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-surface-700 bg-surface-850/50">
              <tr>
                <th className="table-head px-3 py-2">Plugin</th>
                <th className="table-head px-3 py-2">{t('common.version')}</th>
                <th className="table-head px-3 py-2">{t('common.source')}</th>
                <th className="table-head px-3 py-2">{t('common.categories')}</th>
                <th className="table-head px-3 py-2">{t('common.file')}</th>
                <th className="table-head px-3 py-2">{t('common.status')}</th>
                <th className="table-head px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {items.map((plugin) => (
                <tr key={plugin.id} className="hover:bg-surface-850/30">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded border border-surface-700 bg-surface-850 text-slate-500">
                        {plugin.iconUrl ? <img src={plugin.iconUrl} alt="" className="h-full w-full object-cover" /> : <Icon name="plugin" size={14} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-100">{plugin.name}</span>
                        <span className="block truncate text-[11px] text-slate-500">{plugin.description || plugin.slug || plugin.author}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-300">{plugin.version ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="chip">{plugin.source}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {plugin.categories.slice(0, 3).map((cat) => (
                        <span key={cat} className="chip">
                          {cat}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-400">
                    {plugin.fileName ? (
                      <>
                        <span className="block max-w-[180px] truncate font-mono">{plugin.fileName}</span>
                        <span>{plugin.fileSize ? formatBytes(plugin.fileSize) : ''}</span>
                      </>
                    ) : plugin.configTemplateDir ? (
                      <span>{t('library.templateFiles')}</span>
                    ) : (
                      <span className="text-amber-300">{t('library.noFile')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {plugin.fileMissing ? (
                      <span className="badge badge-incompatible">{t('project.missingFile')}</span>
                    ) : plugin.hasFile ? (
                      <CompatBadge level="verified" label={t('library.cached')} />
                    ) : (
                      <CompatBadge level="unknown" label={t('library.notCached')} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {plugin.source === 'modrinth' && plugin.projectUrl ? (
                        <a href={plugin.projectUrl} target="_blank" rel="noreferrer" className="btn btn-xs btn-ghost" title="Modrinth">
                          <Icon name="external" size={12} />
                        </a>
                      ) : null}
                      {plugin.configTemplateDir ? (
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => showTemplate(plugin)} title={t('library.templateFiles')}>
                          <Icon name="file" size={12} />
                        </button>
                      ) : null}
                      {plugin.source === 'modrinth' ? (
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          title={t('library.redownload')}
                          onClick={async () => {
                            try {
                              await api.redownload(plugin.id);
                              toast.success(t('library.redownload'));
                              load();
                            } catch (err) {
                              toast.error(errorMessage(err));
                            }
                          }}
                        >
                          <Icon name="refresh" size={12} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => {
                          setEditTarget(plugin);
                          setEditForm({
                            name: plugin.name,
                            version: plugin.version ?? '',
                            author: plugin.author,
                            description: plugin.description,
                            categories: plugin.categories.join(', '),
                            mcVersions: plugin.mcVersions.join(', '),
                            loaders: plugin.loaders.join(', '),
                            notes: plugin.notes,
                            projectUrl: plugin.projectUrl ?? '',
                          });
                        }}
                      >
                        <Icon name="edit" size={12} />
                      </button>
                      <button type="button" className="btn btn-xs btn-ghost text-red-300" onClick={() => setDeleteTarget(plugin)}>
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={uploadOpen}
        title={t('library.upload')}
        onClose={() => setUploadOpen(false)}
        width="max-w-2xl"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setUploadOpen(false)} disabled={uploading}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={upload} disabled={uploading || !file}>
              {uploading ? t('common.loading') : t('common.upload')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex gap-1 rounded-md border border-surface-700 p-0.5 text-xs">
            {(['jar', 'template'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={`flex-1 rounded px-2 py-1 ${form.kind === kind ? 'bg-surface-700 text-slate-100' : 'text-slate-400'}`}
                onClick={() => {
                  setForm({ ...form, kind });
                  setFile(null);
                }}
              >
                {kind === 'jar' ? t('library.uploadJar') : t('library.uploadZip')}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">{t('library.fileHint')}</p>
          {form.kind === 'template' ? (
            <Field label="Attach to existing plugin" hint="Recommended: attaches these config files to a plugin so they are applied when the plugin is added to a project.">
              <select className="select" value={attachTo} onChange={(event) => setAttachTo(event.target.value)}>
                <option value="">Create a standalone template entry</option>
                {items
                  .filter((item) => item.hasFile)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.version})
                    </option>
                  ))}
              </select>
            </Field>
          ) : null}
          <Field label={t('common.file')}>
            <input
              type="file"
              accept={form.kind === 'jar' ? '.jar' : '.zip'}
              className="input file:mr-3 file:rounded file:border-0 file:bg-surface-700 file:px-2 file:py-1 file:text-xs file:text-slate-200"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={`${t('common.name')} (${t('common.optional')})`} hint="Read from plugin.yml when left empty">
              <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label={`${t('common.version')} (${t('common.optional')})`}>
              <input className="input" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} />
            </Field>
            <Field label={`${t('common.author')} (${t('common.optional')})`}>
              <input className="input" value={form.author} onChange={(event) => setForm({ ...form, author: event.target.value })} />
            </Field>
            <Field label={t('library.categories')}>
              <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-md border border-surface-700 bg-surface-850/40 p-1.5">
                {categories.map((cat) => {
                  const active = form.categories.includes(cat.name);
                  return (
                    <button
                      key={cat.name}
                      type="button"
                      className={`chip ${active ? 'border-accent/60 text-slate-100' : ''}`}
                      onClick={() =>
                        setForm({
                          ...form,
                          categories: active ? form.categories.filter((c) => c !== cat.name) : [...form.categories, cat.name],
                        })
                      }
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
          <Field label={t('common.description')}>
            <textarea className="textarea" rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Minecraft versions" hint="Comma separated, e.g. 1.21.4, 1.21.8">
              <input className="input" value={form.mcVersions} onChange={(event) => setForm({ ...form, mcVersions: event.target.value })} />
            </Field>
            <Field label="Loaders" hint="Comma separated, e.g. paper, folia">
              <input className="input" value={form.loaders} onChange={(event) => setForm({ ...form, loaders: event.target.value })} />
            </Field>
            <Field label="Config folder" hint="Optional. Defaults to the plugin name.">
              <input className="input" value={form.configDir} onChange={(event) => setForm({ ...form, configDir: event.target.value })} placeholder="Essentials" />
            </Field>
            <Field label={`${t('common.notes')} (${t('common.optional')})`}>
              <input className="input" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
          </div>
          {uploadError ? <WarningList warnings={[uploadError]} tone="error" /> : null}
        </div>
      </Modal>

      <Modal open={Boolean(uploadResult)} title={t('library.uploadSuccess')} onClose={() => setUploadResult(null)} width="max-w-xl">
        {uploadResult ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              <span className="font-medium text-slate-100">{uploadResult.plugin.name}</span> · {uploadResult.plugin.version} · {uploadResult.plugin.source}
            </p>
            {uploadResult.kind === 'jar' && uploadResult.inspection ? (
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('library.inspectResult')}</h4>
                <dl className="grid gap-1 text-xs sm:grid-cols-2">
                  {[
                    ['Name', String((uploadResult.inspection as any).name ?? '—')],
                    ['Version', String((uploadResult.inspection as any).version ?? '—')],
                    ['API version', String((uploadResult.inspection as any).apiVersion ?? '—')],
                    ['Folia supported', String((uploadResult.inspection as any).foliaSupported ?? 'unknown')],
                    ['Main class', String((uploadResult.inspection as any).main ?? '—')],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-2 border-b border-surface-800 py-0.5">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="truncate text-right text-slate-300">{value}</dd>
                    </div>
                  ))}
                </dl>
                {Array.isArray((uploadResult.inspection as any).warnings) && (uploadResult.inspection as any).warnings.length > 0 ? (
                  <div className="mt-2">
                    <WarningList warnings={(uploadResult.inspection as any).warnings} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {uploadResult.files ? (
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('library.templateFiles')}</h4>
                <ul className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-[11px] text-slate-400">
                  {uploadResult.files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-[11px] text-slate-500">{t('library.fileHint')}</p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(editTarget)}
        title={t('library.editMetadata')}
        onClose={() => setEditTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditTarget(null)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={busy}>
              {t('common.save')}
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <Field label={t('common.name')}>
            <input className="input" value={editForm.name ?? ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('common.version')}>
              <input className="input" value={editForm.version ?? ''} onChange={(e) => setEditForm({ ...editForm, version: e.target.value })} />
            </Field>
            <Field label={t('common.author')}>
              <input className="input" value={editForm.author ?? ''} onChange={(e) => setEditForm({ ...editForm, author: e.target.value })} />
            </Field>
          </div>
          <Field label={t('common.description')}>
            <textarea className="textarea" rows={2} value={editForm.description ?? ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
          </Field>
          <Field label={t('library.categories')} hint="Comma separated">
            <input className="input" value={editForm.categories ?? ''} onChange={(e) => setEditForm({ ...editForm, categories: e.target.value })} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Minecraft versions" hint="Comma separated">
              <input className="input" value={editForm.mcVersions ?? ''} onChange={(e) => setEditForm({ ...editForm, mcVersions: e.target.value })} />
            </Field>
            <Field label="Loaders">
              <input className="input" value={editForm.loaders ?? ''} onChange={(e) => setEditForm({ ...editForm, loaders: e.target.value })} />
            </Field>
          </div>
          <Field label={t('common.notes')}>
            <textarea className="textarea" rows={2} value={editForm.notes ?? ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('library.deletePlugin')}
        message={t('library.deleteConfirm', { name: deleteTarget?.name ?? '' })}
        danger
        busy={busy}
        confirmLabel={t('common.delete')}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={remove}
      >
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={forceDelete} onChange={(e) => setForceDelete(e.target.checked)} />
          {t('library.forceDelete')}
        </label>
      </ConfirmDialog>

      <Modal open={Boolean(templateTarget)} title={templateTarget?.name ?? ''} onClose={() => setTemplateTarget(null)} width="max-w-2xl">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('library.templateFiles')}</h4>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto font-mono text-[11px]">
              {templateFiles.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className="w-full truncate rounded px-1 py-0.5 text-left text-slate-400 hover:bg-surface-800 hover:text-slate-100"
                    onClick={async () => {
                      if (!templateTarget) return;
                      const data = await fetch(`/api/plugins/library/${templateTarget.id}/template-file?path=${encodeURIComponent(path)}`).then((r) => r.json());
                      setTemplateContent({ path, content: data.content ?? '' });
                    }}
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{templateContent?.path ?? t('common.preview')}</h4>
            <pre className="code-font max-h-64 overflow-auto rounded border border-surface-700 bg-surface-950 p-2 text-[11px] text-slate-300">
              {templateContent?.content ?? 'Select a file to preview it.'}
            </pre>
          </div>
        </div>
      </Modal>

      <Modal open={categoryOpen} title={t('library.categories')} onClose={() => setCategoryOpen(false)} width="max-w-lg">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input className="input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder={t('library.categoryName')} />
            <button type="button" className="btn btn-primary" onClick={addCategory} disabled={!newCategory.trim()}>
              {t('common.add')}
            </button>
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {categories.map((cat) => (
              <li key={cat.name} className="flex items-center justify-between gap-2 rounded border border-surface-800 px-2 py-1">
                <span className="text-slate-300">
                  {cat.name} <span className="text-slate-600">({cat.count})</span>
                </span>
                {!cat.builtin ? (
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost text-red-300"
                    onClick={async () => {
                      await api.library({ limit: 1 });
                      const response = await fetch(`/api/plugins/categories/${encodeURIComponent(cat.name)}`, { method: 'DELETE' });
                      if (response.ok) load();
                    }}
                  >
                    <Icon name="trash" size={11} />
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-600">built-in</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Modal>

      <Modal open={modrinthOpen} title={t('library.searchModrinth')} onClose={() => setModrinthOpen(false)} width="max-w-3xl">
        <div className="space-y-3">
          <SearchInput value={modrinthQuery} onChange={setModrinthQuery} placeholder={t('library.searchPlaceholder')} />
          {hitsError ? <ErrorBanner message={hitsError} onRetry={searchModrinth} /> : null}
          {loadingHits ? (
            <Spinner label={t('common.loading')} />
          ) : scan === 0 ? (
            <EmptyState title={t('common.noResults')} icon="search" />
          ) : (
            <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {hits.map((hit) => (
                <li key={hit.id} className="flex items-center gap-2 rounded border border-surface-800 bg-surface-850/40 px-2.5 py-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded border border-surface-700 bg-surface-850">
                    {hit.iconUrl ? <img src={hit.iconUrl} alt="" className="h-full w-full object-cover" /> : <Icon name="plugin" size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm text-slate-100">{hit.name}</span>
                      <span className="chip">{hit.author}</span>
                    </div>
                    <p className="truncate text-[11px] text-slate-500">{hit.description}</p>
                  </div>
                  <button type="button" className="btn btn-xs btn-secondary shrink-0" onClick={() => openVersions(hit)}>
                    {t('library.downloadToLibrary')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(versionTarget)}
        title={versionTarget ? `${versionTarget.name} — ${t('library.versionChoice')}` : ''}
        onClose={() => setVersionTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setVersionTarget(null)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={downloadToLibrary} disabled={!selectedVersion || downloading}>
              {downloading ? t('common.loading') : t('library.downloadToLibrary')}
            </button>
          </>
        }
      >
        {loadingVersions ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <ul className="max-h-[45vh] space-y-1 overflow-y-auto">
            {versions.slice(0, 40).map((version) => (
              <li key={version.id}>
                <label className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${selectedVersion === version.id ? 'border-accent/60 bg-accent/10' : 'border-surface-700'}`}>
                  <input type="radio" checked={selectedVersion === version.id} onChange={() => setSelectedVersion(version.id)} name="mrversion" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-slate-100">{version.versionNumber}</span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {version.gameVersions.slice(0, 6).join(', ')} · {version.loaders.join(', ')}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
