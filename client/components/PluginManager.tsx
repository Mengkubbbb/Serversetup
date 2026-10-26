import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SOFTWARE_LOADERS, type CategoryInfo, type ModrinthHit, type ModrinthVersion } from '../api';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from './Toast';
import { CompatBadge, ConfirmDialog, EmptyState, ErrorBanner, Field, Icon, InlineError, Modal, SearchInput, Spinner, WarningList } from './ui';
import { formatBytes } from './format';
import type { LibraryPlugin, Project, ProjectPlugin } from '../../shared/types';
import TemplateApplyDialog from './TemplateApplyDialog';

interface Props {
  project: Project;
  plugins: ProjectPlugin[];
  dependencies: { missing: { name: string; kind: string; forPlugin: string; projectId?: string }[]; resolved: { name: string; forPlugin: string }[] };
  onChanged: () => Promise<void> | void;
  autoTemplateId?: string | null;
  onTemplateHandled?: () => void;
}

export default function PluginManager({ project, plugins, dependencies, onChanged, autoTemplateId, onTemplateHandled }: Props) {
  const { t } = useI18n();
  const toast = useToast();

  const [mode, setMode] = useState<'library' | 'modrinth'>('library');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [source, setSource] = useState<'all' | 'local' | 'modrinth'>('all');
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [library, setLibrary] = useState<LibraryPlugin[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  const [hits, setHits] = useState<ModrinthHit[]>([]);
  const [loadingHits, setLoadingHits] = useState(false);
  const [hitsError, setHitsError] = useState<string | null>(null);
  const [versionTarget, setVersionTarget] = useState<ModrinthHit | null>(null);
  const [versions, setVersions] = useState<ModrinthVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionWarning, setVersionWarning] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [versionFiltered, setVersionFiltered] = useState(true);

  const [removeTarget, setRemoveTarget] = useState<ProjectPlugin | null>(null);
  const [removeConfigs, setRemoveConfigs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<ProjectPlugin | null>(null);
  const [replaceLocal, setReplaceLocal] = useState<LibraryPlugin[]>([]);
  const [replaceVersions, setReplaceVersions] = useState<ModrinthVersion[]>([]);
  const [replaceSelection, setReplaceSelection] = useState('');
  const [loadingReplace, setLoadingReplace] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [resolvingDeps, setResolvingDeps] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (autoTemplateId) {
      setTemplateId(autoTemplateId);
      setTemplateOpen(true);
      onTemplateHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTemplateId]);

  const loadLibrary = () => {
    setLoadingLibrary(true);
    setLibraryError(null);
    api
      .library({ q: query, category, source, limit: 60 })
      .then((data) => {
        setLibrary(data.items);
        setCategories(data.categories);
      })
      .catch((err) => setLibraryError(errorMessage(err)))
      .finally(() => setLoadingLibrary(false));
  };

  useEffect(() => {
    if (mode !== 'library') return;
    const timer = window.setTimeout(loadLibrary, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category, source, mode]);

  const searchModrinth = () => {
    setLoadingHits(true);
    setHitsError(null);
    api
      .modrinthSearch({ q: query, mcVersion: project.mcVersion, limit: 20 })
      .then((data) => setHits(data.hits))
      .catch((err) => setHitsError(errorMessage(err)))
      .finally(() => setLoadingHits(false));
  };

  useEffect(() => {
    if (mode !== 'modrinth') return;
    const timer = window.setTimeout(searchModrinth, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode]);

  const openVersions = async (hit: ModrinthHit, filtered = true) => {
    setVersionTarget(hit);
    setLoadingVersions(true);
    setVersionsError(null);
    setVersionWarning(null);
    setVersions([]);
    setSelectedVersion('');
    setVersionFiltered(filtered);
    try {
      const data = await api.modrinthVersions(hit.id, filtered ? { mcVersion: project.mcVersion, loaders: SOFTWARE_LOADERS[project.software] } : {});
      setVersions(data.versions);
      if (data.versions.length === 0 && filtered) {
        setVersionWarning('No version matched the project filters. Showing all published versions instead.');
        setVersionFiltered(false);
        const all = await api.modrinthVersions(hit.id);
        setVersions(all.versions);
      }
      if (data.versions[0]) setSelectedVersion(data.versions[0].id);
    } catch (err) {
      setVersionsError(errorMessage(err));
    } finally {
      setLoadingVersions(false);
    }
  };

  const addLibraryPlugin = async (plugin: LibraryPlugin) => {
    setAddingId(plugin.id);
    try {
      const result = await api.addPlugin(project.id, { libraryPluginId: plugin.id });
      toast.success(t('toast.pluginAdded'));
      if (result.warnings.length > 0) toast.info(result.warnings[0]);
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAddingId(null);
    }
  };

  const installVersion = async () => {
    if (!versionTarget || !selectedVersion) return;
    setBusy(true);
    try {
      const result = await api.addPlugin(project.id, { modrinthProjectId: versionTarget.id, modrinthVersionId: selectedVersion });
      toast.success(t('toast.pluginAdded'));
      if (result.warnings.length > 0) toast.info(result.warnings[0]);
      setVersionTarget(null);
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const openReplace = async (plugin: ProjectPlugin) => {
    setReplaceTarget(plugin);
    setReplaceSelection('');
    setReplaceLocal([]);
    setReplaceVersions([]);
    setReplaceError(null);
    setLoadingReplace(true);
    try {
      const local = await api.library({ q: plugin.displayName, limit: 20 });
      setReplaceLocal(
        local.items.filter((item) => item.name.toLowerCase() === plugin.displayName.toLowerCase() && item.id !== plugin.libraryPluginId),
      );
      if (plugin.sourceProjectId) {
        const versions = await api.modrinthVersions(plugin.sourceProjectId, {
          mcVersion: project.mcVersion,
          loaders: SOFTWARE_LOADERS[project.software],
        });
        setReplaceVersions(versions.versions);
        if (versions.versions.length === 0) {
          const all = await api.modrinthVersions(plugin.sourceProjectId);
          setReplaceVersions(all.versions);
        }
      }
    } catch (err) {
      setReplaceError(errorMessage(err));
    } finally {
      setLoadingReplace(false);
    }
  };

  const confirmReplace = async () => {
    if (!replaceTarget || !replaceSelection) return;
    setBusy(true);
    setReplaceError(null);
    try {
      const [kind, id] = replaceSelection.split(':').length > 2
        ? [replaceSelection.split(':')[0], replaceSelection.split(':').slice(1).join(':')]
        : replaceSelection.split(':');
      if (kind === 'local') {
        await api.replacePluginVersion(project.id, replaceTarget.id, { libraryPluginId: id });
      } else {
        await api.replacePluginVersion(project.id, replaceTarget.id, {
          modrinthProjectId: replaceTarget.sourceProjectId ?? undefined,
          modrinthVersionId: id,
        });
      }
      toast.success(t('common.saved'));
      setReplaceTarget(null);
      await onChanged();
    } catch (err) {
      setReplaceError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const resolveDependencies = async () => {
    setResolvingDeps(true);
    try {
      const result = await api.resolveDependencies(project.id);
      if (result.installed.length > 0) toast.success(`${result.installed.map((item) => item.name).join(', ')}`);
      result.failed.forEach((failure) => toast.error(`${failure.name}: ${failure.reason}`));
      if (result.installed.length === 0 && result.failed.length === 0) toast.info(t('project.noDependencyIssues'));
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setResolvingDeps(false);
    }
  };

  const removePlugin = async () => {
    if (!removeTarget) return;
    setBusy(true);
    try {
      await api.removePlugin(project.id, removeTarget.id, removeConfigs);
      toast.success(t('toast.pluginRemoved'));
      setRemoveTarget(null);
      setRemoveConfigs(false);
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reinstall = async (plugin: ProjectPlugin) => {
    try {
      if (plugin.libraryPluginId) await api.redownload(plugin.libraryPluginId);
      await api.reinstallPlugin(project.id, plugin.id);
      toast.success(t('project.reinstall'));
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const installedNames = new Set(plugins.map((p) => p.displayName.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-xs btn-primary" onClick={() => setTemplateOpen(true)}>
          <Icon name="layers" size={12} /> {t('project.applyTemplate')}
        </button>
        <button type="button" className="btn btn-xs btn-secondary" onClick={() => setMode(mode === 'library' ? 'modrinth' : 'library')}>
          <Icon name={mode === 'library' ? 'sparkles' : 'package'} size={12} /> {mode === 'library' ? t('library.searchModrinth') : t('library.localLibrary')}
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {plugins.length} {t('project.plugins').toLowerCase()}
        </span>
      </div>

      {dependencies.missing.length > 0 ? (
        <div className="rounded-md border border-amber-900/60 bg-amber-950/20 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-200">{t('project.dependencies')}</h4>
          <ul className="mt-1 space-y-1 text-xs text-amber-100">
            {dependencies.missing.map((dep, index) => (
              <li key={index}>
                <span className="font-mono">{dep.name}</span> — required by {dep.forPlugin}
                {dep.projectId ? <span className="ml-1 text-amber-300/70">(Modrinth {dep.projectId})</span> : null}
              </li>
            ))}
          </ul>
          {dependencies.missing.some((dep) => dep.projectId) ? (
            <button type="button" className="btn btn-xs btn-secondary mt-2" onClick={resolveDependencies} disabled={resolvingDeps}>
              <Icon name="download" size={12} /> {resolvingDeps ? t('common.loading') : 'Resolve Modrinth dependencies'}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-emerald-300/80">{t('project.noDependencyIssues')}</p>
      )}

      <div className="card overflow-hidden">
        <div className="card-header">
          <h3 className="text-sm font-semibold text-slate-200">{t('project.installedPlugins')}</h3>
          <span className="text-xs text-slate-500">{plugins.length}</span>
        </div>
        {plugins.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t('project.noPlugins')} description={t('dashboard.step2')} icon="plugin" />
          </div>
        ) : (
          <ul className="divide-y divide-surface-800">
            {plugins.map((plugin) => (
              <li key={plugin.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-slate-100">{plugin.displayName}</span>
                    <span className="chip">{plugin.version ?? '—'}</span>
                    <span className="chip">{plugin.source}</span>
                    {plugin.status === 'missing' ? <span className="badge badge-incompatible">{t('project.missingFile')}</span> : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className="font-mono">{plugin.fileName}</span>
                    <span>· {plugin.configDir}</span>
                  </div>
                </div>
                <CompatBadge level={plugin.compatibility.level} />
                <div className="flex items-center gap-1">
                  <Link to={`/editor?project=${project.id}&plugin=${plugin.id}`} className="btn btn-xs btn-ghost">
                    <Icon name="sliders" size={12} /> {t('project.openConfig')}
                  </Link>
                  <button type="button" className="btn btn-xs btn-ghost" onClick={() => openReplace(plugin)} title={t('library.versionChoice')}>
                    <Icon name="refresh" size={12} /> {t('common.version')}
                  </button>
                  {plugin.status === 'missing' && plugin.libraryPluginId ? (
                    <button type="button" className="btn btn-xs btn-secondary" onClick={() => reinstall(plugin)}>
                      <Icon name="refresh" size={12} /> {t('project.reinstall')}
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-xs btn-ghost text-red-300" onClick={() => setRemoveTarget(plugin)} title={t('project.removePlugin')}>
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="text-sm font-semibold text-slate-200">{t('project.addPlugins')}</h3>
          <span className="text-xs text-slate-500">
            {mode === 'library' ? t('library.localLibrary') : 'Modrinth'}
          </span>
        </div>
        <div className="space-y-2 border-b border-surface-800 p-3">
          <SearchInput value={query} onChange={setQuery} placeholder={mode === 'library' ? t('library.searchPlaceholder') : 'Search Modrinth plugins…'} />
          {mode === 'library' ? (
            <div className="flex flex-wrap gap-2">
              <select className="select max-w-[220px] text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">{t('common.all')} {t('common.categories').toLowerCase()}</option>
                {categories.map((cat) => (
                  <option key={cat.name} value={cat.name}>
                    {cat.name} ({cat.count})
                  </option>
                ))}
              </select>
              <select className="select max-w-[170px] text-xs" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                <option value="all">{t('library.allSources')}</option>
                <option value="local">Local</option>
                <option value="modrinth">Modrinth</option>
              </select>
              <span className="ml-auto self-center text-[11px] text-slate-500">
                {project.mcVersion} · {project.software}
              </span>
            </div>
          ) : null}
        </div>
        <div className="max-h-[420px] overflow-y-auto p-3">
          {mode === 'library' ? (
            loadingLibrary ? (
              <Spinner label={t('common.loading')} />
            ) : libraryError ? (
              <ErrorBanner message={libraryError} onRetry={loadLibrary} />
            ) : library.length === 0 ? (
              <EmptyState
                title={t('common.noResults')}
                description={t('library.fileHint')}
                icon="package"
                action={
                  <Link to="/library" className="btn btn-xs btn-secondary">
                    {t('library.upload')}
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-1.5">
                {library.map((plugin) => {
                  const already = installedNames.has(plugin.name.toLowerCase());
                  return (
                    <li key={plugin.id} className="flex items-center gap-2 rounded-md border border-surface-800 bg-surface-850/40 px-2.5 py-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded border border-surface-700 bg-surface-850 text-slate-500">
                        {plugin.iconUrl ? <img src={plugin.iconUrl} alt="" className="h-full w-full object-cover" /> : <Icon name="plugin" size={14} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm text-slate-100">{plugin.name}</span>
                          <span className="chip">{plugin.version ?? '—'}</span>
                          <CompatBadge level={plugin.source === 'local' ? 'unknown' : 'potential'} label={plugin.source} />
                          {!plugin.hasFile ? <span className="badge badge-incompatible">{t('library.noFile')}</span> : null}
                        </div>
                        <p className="truncate text-[11px] text-slate-500">{plugin.description || '—'}</p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-xs btn-secondary shrink-0"
                        disabled={already || addingId === plugin.id}
                        onClick={() => addLibraryPlugin(plugin)}
                      >
                        {already ? t('common.installed') : addingId === plugin.id ? '…' : t('common.add')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : loadingHits ? (
            <Spinner label={t('common.loading')} />
          ) : hitsError ? (
            <ErrorBanner message={hitsError} onRetry={searchModrinth} />
          ) : hits.length === 0 ? (
            <EmptyState title={t('common.noResults')} description={t('library.noVersions')} icon="search" />
          ) : (
            <ul className="space-y-1.5">
              {hits.map((hit) => (
                <li key={hit.id} className="flex items-center gap-2 rounded-md border border-surface-800 bg-surface-850/40 px-2.5 py-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded border border-surface-700 bg-surface-850 text-slate-500">
                    {hit.iconUrl ? <img src={hit.iconUrl} alt="" className="h-full w-full object-cover" /> : <Icon name="plugin" size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm text-slate-100">{hit.name}</span>
                      <span className="chip">{hit.author}</span>
                      {hit.mcVersions.includes(project.mcVersion) ? <span className="badge badge-potential">lists {project.mcVersion}</span> : null}
                    </div>
                    <p className="truncate text-[11px] text-slate-500">{hit.description}</p>
                  </div>
                  <button type="button" className="btn btn-xs btn-secondary shrink-0" onClick={() => openVersions(hit)} disabled={installedNames.has(hit.name.toLowerCase())}>
                    {installedNames.has(hit.name.toLowerCase()) ? t('common.installed') : t('library.versionChoice')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(versionTarget)}
        title={versionTarget ? `${versionTarget.name} — ${t('library.versionChoice')}` : ''}
        onClose={() => setVersionTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setVersionTarget(null)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={installVersion} disabled={!selectedVersion || busy}>
              {busy ? t('common.loading') : t('common.install')}
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            {versionFiltered ? `Filtered for Minecraft ${project.mcVersion} and ${project.software}.` : 'Showing all published versions.'}
          </p>
          {versionWarning ? <WarningList warnings={[versionWarning]} /> : null}
          {versionsError ? <ErrorBanner message={versionsError} /> : null}
          {loadingVersions ? (
            <Spinner label={t('common.loading')} />
          ) : versions.length === 0 ? (
            <EmptyState title={t('library.noVersions')} icon="info" />
          ) : (
            <ul className="max-h-[45vh] space-y-1 overflow-y-auto">
              {versions.slice(0, 40).map((version) => (
                <li key={version.id}>
                  <label className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 text-xs ${selectedVersion === version.id ? 'border-accent/60 bg-accent/10' : 'border-surface-700 bg-surface-850/40'}`}>
                    <input type="radio" name="version" value={version.id} checked={selectedVersion === version.id} onChange={() => setSelectedVersion(version.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-slate-100">
                        {version.versionNumber} <span className="text-slate-500">· {version.versionType}</span>
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {version.gameVersions.slice(0, 6).join(', ')}
                        {version.gameVersions.length > 6 ? '…' : ''} · {version.loaders.join(', ')}
                      </span>
                      {version.files[0] ? <span className="block text-[11px] text-slate-600">{version.files[0].filename} · {formatBytes(version.files[0].size)}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-500">
            Downloading verifies the SHA-512 hash when Modrinth provides one, and the file is cached in your local plugin storage.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={t('project.removePlugin')}
        message={t('project.removeConfirm', { name: removeTarget?.displayName ?? '' })}
        confirmLabel={t('common.remove')}
        danger
        busy={busy}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={removePlugin}
      >
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={removeConfigs} onChange={(e) => setRemoveConfigs(e.target.checked)} />
          {t('project.removeConfigsHint')}
        </label>
      </ConfirmDialog>

      <Modal
        open={Boolean(replaceTarget)}
        title={replaceTarget ? `${replaceTarget.displayName} — ${t('library.versionChoice')}` : ''}
        onClose={() => setReplaceTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setReplaceTarget(null)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmReplace} disabled={!replaceSelection || busy}>
              {busy ? t('common.loading') : t('common.save')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Configuration files are kept; only the plugin file and version change.</p>
          {replaceError ? <ErrorBanner message={replaceError} /> : null}
          {loadingReplace ? (
            <Spinner label={t('common.loading')} />
          ) : (
            <>
              {replaceLocal.length > 0 ? (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('library.localLibrary')}</h4>
                  <ul className="space-y-1">
                    {replaceLocal.map((item) => (
                      <li key={item.id}>
                        <label className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs ${replaceSelection === `local:${item.id}` ? 'border-accent/60 bg-accent/10' : 'border-surface-700'}`}>
                          <input type="radio" name="replacement" checked={replaceSelection === `local:${item.id}`} onChange={() => setReplaceSelection(`local:${item.id}`)} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-slate-100">{item.version ?? 'unknown version'}</span>
                            <span className="block truncate text-[11px] text-slate-500">
                              {item.fileName ?? 'no file'} · {item.mcVersions.slice(0, 5).join(', ') || 'no version metadata'}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {replaceVersions.length > 0 ? (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Modrinth</h4>
                  <ul className="max-h-[40vh] space-y-1 overflow-y-auto">
                    {replaceVersions.slice(0, 40).map((version) => (
                      <li key={version.id}>
                        <label className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs ${replaceSelection === `modrinth:${version.id}` ? 'border-accent/60 bg-accent/10' : 'border-surface-700'}`}>
                          <input type="radio" name="replacement" checked={replaceSelection === `modrinth:${version.id}`} onChange={() => setReplaceSelection(`modrinth:${version.id}`)} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-slate-100">{version.versionNumber} <span className="text-slate-500">· {version.versionType}</span></span>
                            <span className="block truncate text-[11px] text-slate-500">
                              {version.gameVersions.slice(0, 6).join(', ')} · {version.loaders.join(', ')}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {replaceLocal.length === 0 && replaceVersions.length === 0 ? (
                <EmptyState title={t('library.noVersions')} description="Upload another version of this plugin or check its Modrinth project." icon="package" />
              ) : null}
            </>
          )}
        </div>
      </Modal>

      <TemplateApplyDialog
        open={templateOpen}
        initialTemplateId={templateId ?? undefined}
        projects={[project]}
        projectId={project.id}
        onClose={() => {
          setTemplateOpen(false);
          setTemplateId(null);
        }}
        onApplied={async () => {
          setTemplateOpen(false);
          setTemplateId(null);
          await onChanged();
        }}
      />
    </div>
  );
}
