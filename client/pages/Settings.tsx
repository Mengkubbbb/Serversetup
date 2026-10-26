import React, { useEffect, useState } from 'react';
import { api, type SettingsPayload } from '../api';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from '../components/Toast';
import { ErrorBanner, Field, Icon, KeyValue, LoadingBlock, PageHeader, WarningList } from '../components/ui';
import { formatBytes } from '../components/format';

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const toast = useToast();
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultLanguage, setDefaultLanguage] = useState<'en' | 'th'>('en');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .settings()
      .then((data) => {
        setSettings(data);
        setDefaultLanguage((data.settings.default_language as 'en' | 'th') ?? 'en');
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const saveLanguage = async () => {
    setSaving(true);
    try {
      await api.updateSettings({ default_language: defaultLanguage });
      setLang(defaultLanguage);
      toast.success(t('settings.defaultLanguageSaved'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error || !settings) return <ErrorBanner message={error ?? t('error.generic')} onRetry={load} />;

  return (
    <div>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">{t('common.language')}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('settings.language')}>
              <select className="select" value={defaultLanguage} onChange={(event) => setDefaultLanguage(event.target.value as 'en' | 'th')}>
                <option value="en">English</option>
                <option value="th">ไทย (Thai)</option>
              </select>
            </Field>
            <button type="button" className="btn btn-primary" onClick={saveLanguage} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            The current interface language is {lang === 'th' ? 'ไทย' : 'English'}. Each project also stores its own language.
          </p>
        </section>

        <section className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">{t('settings.ai')}</h2>
            <span className={`badge ${settings.ai.configured ? 'badge-verified' : 'badge-unknown'}`}>
              {settings.ai.configured ? t('settings.aiConfigured') : t('settings.aiMissing')}
            </span>
          </div>
          <KeyValue
            items={[
              { label: 'Provider', value: settings.ai.provider },
              { label: 'Model', value: settings.ai.model },
              { label: 'Status', value: settings.ai.configured ? 'ready' : 'disabled' },
            ]}
          />
          {settings.ai.reason ? <p className="mt-2 text-[11px] text-amber-200">{settings.ai.reason}</p> : null}
          <div className="mt-3 rounded-md border border-surface-700 bg-surface-850/50 p-2.5">
            <p className="text-[11px] text-slate-400">{t('settings.envHint')}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL'].map((name) => (
                <code key={name} className="chip font-mono">
                  {name}
                </code>
              ))}
            </div>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">{t('settings.storage')}</h2>
          <KeyValue
            items={[
              { label: t('settings.pluginStorage'), value: formatBytes(settings.storage.pluginBytes) },
              { label: t('settings.templateStorage'), value: formatBytes(settings.storage.templateBytes) },
              { label: t('settings.dataDir'), value: 'DATA_DIR (relative path configured)' },
            ]}
          />
          <p className="mt-2 text-[11px] text-slate-500">
            Plugin JARs are stored under <code className="font-mono">plugins/modrinth/&lt;project&gt;/&lt;version&gt;/</code> and{' '}
            <code className="font-mono">plugins/uploaded/&lt;id&gt;/</code>. Configuration templates live under{' '}
            <code className="font-mono">templates/</code>. Absolute paths are never sent to the browser.
          </p>
        </section>

        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">{t('settings.limits')}</h2>
          <KeyValue
            items={[
              { label: 'Max upload', value: formatBytes(settings.limits.maxUploadBytes) },
              { label: 'Max download', value: formatBytes(settings.limits.maxDownloadBytes) },
              { label: 'Max archive entries', value: settings.limits.maxArchiveEntries },
              { label: 'Max extracted', value: formatBytes(settings.limits.maxExtractedBytes) },
              { label: 'Request timeout', value: `${settings.limits.requestTimeoutMs} ms` },
            ]}
          />
          <p className="mt-2 text-[11px] text-slate-500">Limits are configurable through environment variables; change them in .env and restart.</p>
        </section>

        <section className="card p-4 lg:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <Icon name="shield" size={15} className="text-emerald-300" />
            <h2 className="text-sm font-semibold text-slate-200">{t('settings.security')}</h2>
          </div>
          <WarningList warnings={[settings.security.publicDeployment]} />
          <div className="mt-2 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-2">
            <div className="rounded border border-surface-700 bg-surface-850/40 p-2.5">
              <div className="text-slate-300">Outbound downloads</div>
              <p className="mt-0.5">{settings.security.externalDownloads}</p>
            </div>
            <div className="rounded border border-surface-700 bg-surface-850/40 p-2.5">
              <div className="text-slate-300">{t('settings.modrinthUa')}</div>
              <p className="mt-0.5 break-all font-mono">{settings.security.modrinthUserAgent}</p>
            </div>
            <div className="rounded border border-surface-700 bg-surface-850/40 p-2.5">
              <div className="text-slate-300">Uploaded archives</div>
              <p className="mt-0.5">ZIPs are inspected for traversal, symlinks and size limits. JARs are never executed; only plugin.yml is read.</p>
            </div>
            <div className="rounded border border-surface-700 bg-surface-850/40 p-2.5">
              <div className="text-slate-300">Secrets</div>
              <p className="mt-0.5">API keys stay in .env on the server. Exports contain only plugins/ and never include .env or the database.</p>
            </div>
          </div>
        </section>

        <section className="card p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">{t('settings.about')}</h2>
          <KeyValue
            items={[
              { label: 'Application', value: 'Minecraft Server Setup Maker 1.0.0' },
              { label: 'Metadata', value: 'Mojang version manifest · PaperMC Fill v3 · GitHub (Leaf)' },
              { label: 'Plugin sources', value: 'Modrinth API · local uploads' },
              { label: 'Cache', value: t('settings.refreshCache') },
            ]}
          />
        </section>
      </div>
    </div>
  );
}
