import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type MinecraftVersion } from '../api';
import { ErrorBanner, Field, Icon, InlineError, LoadingBlock, SearchInput, Spinner } from '../components/ui';
import { formatBytes } from '../components/format';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from '../components/Toast';
import type { ServerSoftware, ServerTemplate, VersionChannel } from '../../shared/types';

const SOFTWARE_INFO: Record<ServerSoftware, { label: string; url: string; noteKey: 'wizard.foliaNote' | 'wizard.leafNote' | 'wizard.paperNote' }> = {
  paper: { label: 'Paper', url: 'https://papermc.io/software/paper', noteKey: 'wizard.paperNote' },
  folia: { label: 'Folia', url: 'https://papermc.io/software/folia', noteKey: 'wizard.foliaNote' },
  leaf: { label: 'Leaf', url: 'https://github.com/Winds-Studio/Leaf', noteKey: 'wizard.leafNote' },
};

const STEPS = ['wizard.stepInfo', 'wizard.stepVersion', 'wizard.stepSoftware', 'wizard.stepReview'] as const;

type Channel = VersionChannel;

function channelLabel(channel: string): string {
  if (channel === 'release') return 'Release';
  if (channel === 'snapshot') return 'Snapshot';
  if (channel === 'prerelease') return 'Prerelease';
  return 'Custom';
}

export default function Wizard() {
  const { t, lang, setLang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [serverName, setServerName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [language, setLanguage] = useState<'en' | 'th'>(lang);
  const [mcVersion, setMcVersion] = useState('');
  const [customVersion, setCustomVersion] = useState('');
  const [software, setSoftware] = useState<ServerSoftware>('paper');
  const [build, setBuild] = useState('');
  const [templates, setTemplates] = useState<ServerTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');

  const [versions, setVersions] = useState<MinecraftVersion[]>([]);
  const [versionsWarning, setVersionsWarning] = useState<string | null>(null);
  const [versionQuery, setVersionQuery] = useState('');
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [softwareVersions, setSoftwareVersions] = useState<string[]>([]);
  const [softwareWarning, setSoftwareWarning] = useState<string | null>(null);
  const [loadingSoftware, setLoadingSoftware] = useState(false);
  const [builds, setBuilds] = useState<{ id: string; channel: string; time: string }[]>([]);
  const [buildsWarning, setBuildsWarning] = useState<string | null>(null);
  const [loadingBuilds, setLoadingBuilds] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  useEffect(() => {
    api
      .minecraftVersions()
      .then((data) => {
        setVersions(data.versions);
        setVersionsWarning(data.warning ?? null);
      })
      .catch((err) => setVersionsWarning(errorMessage(err)))
      .finally(() => setLoadingVersions(false));
    api.templates().then((data) => setTemplates(data.templates)).catch(() => undefined);
  }, []);

  useEffect(() => {
    setSoftwareVersions([]);
    setSoftwareWarning(null);
    setBuild('');
    setBuilds([]);
    setLoadingSoftware(true);
    api
      .minecraftVersions(software)
      .then((data) => {
        setSoftwareVersions(data.software?.versions ?? []);
        setSoftwareWarning(data.software?.warning ?? data.warning ?? null);
      })
      .catch((err) => setSoftwareWarning(errorMessage(err)))
      .finally(() => setLoadingSoftware(false));
  }, [software]);

  useEffect(() => {
    if (!mcVersion) return;
    setLoadingBuilds(true);
    setBuildsWarning(null);
    api
      .builds(software, mcVersion)
      .then((data) => {
        setBuilds(data.builds);
        setBuildsWarning(data.warning ?? null);
        if (data.builds.length > 0) setBuild(data.builds[0].id);
      })
      .catch((err) => setBuildsWarning(errorMessage(err)))
      .finally(() => setLoadingBuilds(false));
  }, [software, mcVersion]);

  const selectedVersion = useMemo(() => versions.find((v) => v.id === mcVersion), [versions, mcVersion]);
  const effectiveVersion = customVersion.trim() || mcVersion;
  const versionVerified = Boolean(selectedVersion) && !customVersion.trim();
  const versionChannel: Channel = customVersion.trim() ? 'custom' : (selectedVersion?.type as Channel) ?? 'custom';
  const supportedBySoftware = softwareVersions.includes(effectiveVersion);
  const filteredVersions = useMemo(() => {
    const query = versionQuery.trim().toLowerCase();
    const filtered = query ? versions.filter((v) => v.id.toLowerCase().includes(query)) : versions;
    return filtered.slice(0, 400);
  }, [versions, versionQuery]);

  const onIcon = (file: File | null) => {
    if (!file) {
      setIcon(null);
      return;
    }
    if (!/image\/(png|webp|jpeg)/.test(file.type)) {
      toast.error('Use a PNG, WEBP or JPEG image.');
      return;
    }
    if (file.size > 100 * 1024) {
      toast.error('Icon must be smaller than 100 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setIcon(String(reader.result));
    reader.readAsDataURL(file);
  };

  const validateStep = (): boolean => {
    setStepError(null);
    if (step === 0) {
      if (!name.trim() || !serverName.trim()) {
        setStepError(t('wizard.nameRequired'));
        return false;
      }
    }
    if (step === 1) {
      if (!effectiveVersion) {
        setStepError(t('wizard.versionRequired'));
        return false;
      }
      if (!/^\d{1,2}\.\d{1,2}(\.\d{1,2})?(-\S+)?$|^\d{2}w\d{2}[a-z]$/i.test(effectiveVersion)) {
        setStepError('Version format should look like 1.21.4, 26.3 or 26.4-snapshot-1.');
        return false;
      }
    }
    return true;
  };

  const next = () => {
    if (!validateStep()) return;
    setStep((current) => Math.min(current + 1, 3));
  };

  const create = async () => {
    if (!validateStep()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await api.createProject({
        name: name.trim(),
        serverName: serverName.trim(),
        description,
        icon,
        language,
        mcVersion: effectiveVersion,
        software,
        softwareBuild: build || null,
        templateId: templateId || null,
      });
      setLang(language);
      toast.success(t('toast.projectCreated'));
      if (result.versionWarning) toast.info(result.versionWarning);
      navigate(`/projects/${result.project.id}?template=${templateId || ''}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">{t('wizard.title')}</h1>
        <span className="text-xs text-slate-500">
          {step + 1} / {STEPS.length}
        </span>
      </div>

      <ol className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((key, index) => (
          <li
            key={key}
            className={`rounded-md border px-3 py-2 text-xs ${
              index === step
                ? 'border-accent/50 bg-accent/10 text-slate-100'
                : index < step
                  ? 'border-surface-700 bg-surface-850 text-slate-400'
                  : 'border-surface-800 bg-surface-900 text-slate-600'
            }`}
          >
            <span className="mr-1.5 inline-grid h-4 w-4 place-items-center rounded-full border border-current text-[10px]">{index < step ? '✓' : index + 1}</span>
            {t(key)}
          </li>
        ))}
      </ol>

      <div className="card p-4 sm:p-5">
        {step === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('wizard.projectName')} htmlFor="name" hint="Internal name for this setup">
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('wizard.projectNamePlaceholder')} maxLength={80} />
            </Field>
            <Field label={t('wizard.serverName')} htmlFor="serverName" hint="Used for the exported ZIP name">
              <input id="serverName" className="input" value={serverName} onChange={(e) => setServerName(e.target.value)} placeholder={t('wizard.serverNamePlaceholder')} maxLength={80} />
            </Field>
            <Field label={t('wizard.language')} htmlFor="language">
              <select
                id="language"
                className="select"
                value={language}
                onChange={(e) => {
                  const nextLang = e.target.value as 'en' | 'th';
                  setLanguage(nextLang);
                  setLang(nextLang);
                }}
              >
                <option value="en">English</option>
                <option value="th">ไทย (Thai)</option>
              </select>
            </Field>
            <Field label={t('wizard.icon')} hint={t('wizard.iconHint')} htmlFor="icon">
              <input id="icon" type="file" accept="image/png,image/webp,image/jpeg" className="input file:mr-3 file:rounded file:border-0 file:bg-surface-700 file:px-2 file:py-1 file:text-xs file:text-slate-200" onChange={(e) => onIcon(e.target.files?.[0] ?? null)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={`${t('wizard.description')} (${t('common.optional')})`} htmlFor="description">
                <textarea id="description" className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
              </Field>
            </div>
            {icon ? <img src={icon} alt="Project icon preview" className="h-12 w-12 rounded border border-surface-700 object-cover" /> : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[240px] flex-1">
                <label className="label">{t('wizard.searchVersions')}</label>
                <SearchInput value={versionQuery} onChange={setVersionQuery} placeholder="1.21, 26.3, snapshot…" />
              </div>
              <div className="min-w-[180px]">
                <label className="label">{t('wizard.customVersion')}</label>
                <input className="input" value={customVersion} onChange={(e) => setCustomVersion(e.target.value)} placeholder="e.g. 26.3" />
              </div>
            </div>
            <p className="text-xs text-slate-500">{t('wizard.customVersionHint')}</p>
            {versionsWarning ? <ErrorBanner message={versionsWarning} /> : null}
            {loadingVersions ? (
              <Spinner label={t('common.loading')} />
            ) : (
              <div className="max-h-[340px] overflow-y-auto rounded-md border border-surface-700">
                {filteredVersions.length === 0 ? (
                  <p className="p-4 text-sm text-slate-400">{t('common.noResults')}</p>
                ) : (
                  <ul className="divide-y divide-surface-800">
                    {filteredVersions.map((version) => {
                      const isSelected = !customVersion.trim() && mcVersion === version.id;
                      return (
                        <li key={version.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setMcVersion(version.id);
                              setCustomVersion('');
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-850 ${
                              isSelected ? 'bg-accent/10 text-slate-100' : 'text-slate-300'
                            }`}
                          >
                            <span className="font-mono text-xs">{version.id}</span>
                            <span className={`badge ${version.type === 'release' ? 'badge-verified' : version.type === 'snapshot' ? 'badge-unknown' : 'badge-potential'}`}>
                              {channelLabel(version.type)}
                            </span>
                            {version.id === '26.3' ? <span className="chip">{t('templates.recommended')}</span> : null}
                            {isSelected ? <Icon name="check" size={14} className="ml-auto text-accent" /> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            <div className="rounded-md border border-surface-700 bg-surface-850/50 px-3 py-2 text-xs text-slate-400">
              {effectiveVersion ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-slate-200">{effectiveVersion}</span>
                  <span className={`badge ${versionVerified ? 'badge-verified' : 'badge-unknown'}`}>
                    {versionVerified ? t('wizard.versionVerified') : t('wizard.versionUnverified')}
                  </span>
                  <span className="chip">{channelLabel(versionChannel)}</span>
                  {softwareWarning ? <span className="badge badge-potential">{softwareWarning}</span> : null}
                </span>
              ) : (
                <span>{t('wizard.versionRequired')}</span>
              )}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(SOFTWARE_INFO) as ServerSoftware[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSoftware(id)}
                  className={`rounded-md border px-3 py-3 text-left transition-colors ${
                    software === id ? 'border-accent/60 bg-accent/10' : 'border-surface-700 bg-surface-850/50 hover:border-surface-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-100">{SOFTWARE_INFO[id].label}</span>
                    {software === id ? <Icon name="check" size={14} className="text-accent" /> : null}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">{id === 'paper' ? 'PaperMC' : id === 'folia' ? 'PaperMC' : 'Winds-Studio'}</div>
                </button>
              ))}
            </div>
            <p className="rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">{t(SOFTWARE_INFO[software].noteKey)}</p>

            <div className="rounded-md border border-surface-700 bg-surface-850/40 p-3 text-xs text-slate-400">
              {loadingSoftware ? (
                <Spinner label="Loading software metadata…" />
              ) : (
                <div className="space-y-1">
                  <div>
                    {softwareVersions.length} Minecraft versions published for {SOFTWARE_INFO[software].label}.{' '}
                    {effectiveVersion ? (
                      supportedBySoftware ? (
                        <span className="text-emerald-300">Version {effectiveVersion} appears in the official version list.</span>
                      ) : (
                        <span className="text-amber-300">Version {effectiveVersion} is not listed for {SOFTWARE_INFO[software].label} in metadata.</span>
                      )
                    ) : null}
                  </div>
                  {softwareWarning ? <div className="text-amber-300">{softwareWarning}</div> : null}
                  <a href={SOFTWARE_INFO[software].url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:text-accent-soft">
                    Official project page <Icon name="external" size={11} />
                  </a>
                </div>
              )}
            </div>

            <Field label={`${t('wizard.build')} (${t('common.optional')})`} hint={t('wizard.softwareHint')}>
              {loadingBuilds ? (
                <Spinner label={t('common.loading')} />
              ) : (
                <select className="select" value={build} onChange={(e) => setBuild(e.target.value)}>
                  <option value="">{t('wizard.buildLatest')}</option>
                  {builds.slice(0, 40).map((item) => (
                    <option key={item.id} value={item.id}>
                      #{item.id} · {item.channel} · {new Date(item.time).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              )}
              {!loadingBuilds && builds.length === 0 ? <p className="mt-1 text-xs text-slate-500">{buildsWarning ?? t('wizard.noBuilds')}</p> : null}
              {builds.length > 40 ? <p className="mt-1 text-xs text-slate-500">Showing the 40 newest of {builds.length} builds.</p> : null}
            </Field>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {[
                { label: t('wizard.projectName'), value: name || '—' },
                { label: t('wizard.serverName'), value: serverName || '—' },
                { label: t('wizard.mcVersion'), value: `${effectiveVersion || '—'} ${versionVerified ? '✓' : '(custom)'}` },
                { label: t('wizard.software'), value: `${software}${build ? ` #${build}` : ''}` },
                { label: t('wizard.language'), value: language === 'th' ? 'ไทย' : 'English' },
                { label: t('wizard.pluginCount'), value: '0' },
              ].map((row) => (
                <div key={row.label} className="flex justify-between gap-3 border-b border-surface-800 py-1">
                  <dt className="text-slate-500">{row.label}</dt>
                  <dd className="text-right text-slate-200">{row.value}</dd>
                </div>
              ))}
            </dl>
            <Field label={`${t('wizard.setupTemplate')} (${t('common.optional')})`} hint="Templates are applied later, after a preview and your approval.">
              <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">{t('wizard.noTemplate')}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {template.plugins.length} plugins
                  </option>
                ))}
              </select>
            </Field>
            {supportedBySoftware === false && effectiveVersion ? (
              <p className="rounded-md border border-amber-900/60 bg-amber-950/25 px-3 py-2 text-xs text-amber-100">
                {SOFTWARE_INFO[software].label} metadata does not list Minecraft {effectiveVersion}. You can continue, but verify compatibility before production use.
              </p>
            ) : null}
            {description ? <p className="text-sm text-slate-400">{description}</p> : null}
            {error ? <ErrorBanner message={error} /> : null}
          </div>
        ) : null}

        {stepError ? (
          <div className="mt-4">
            <InlineError message={stepError} />
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button type="button" className="btn btn-secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || creating}>
          {t('common.back')}
        </button>
        {step < 3 ? (
          <button type="button" className="btn btn-primary" onClick={next}>
            {t('common.next')}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>
            {creating ? t('wizard.creating') : t('wizard.create')}
          </button>
        )}
      </div>
    </div>
  );
}
