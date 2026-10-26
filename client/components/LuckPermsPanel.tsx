import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from './Toast';
import { CopyButton, EmptyState, Icon, Spinner, WarningList } from './ui';
import type { Project, ProjectPlugin } from '../../shared/types';

interface Guide {
  summary: string;
  docs: { label: string; url: string }[];
  inGameCommands: { command: string; description: string }[];
  permissionNodes: { node: string; description: string; plugin: string }[];
  rolePlanning: { title: string; notes: string[] }[];
  configFiles: { path: string; note: string }[];
  warnings: string[];
}

export default function LuckPermsPanel({ project, plugins, onChanged }: { project: Project; plugins: ProjectPlugin[]; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const luckPerms = plugins.find((plugin) => /luckperms/i.test(plugin.displayName) || /luckperms/i.test(plugin.configDir ?? ''));

  useEffect(() => {
    setNotes(luckPerms?.notes ?? '');
  }, [luckPerms?.id, luckPerms?.notes]);

  useEffect(() => {
    api
      .luckPermsGuide()
      .then((data) => setGuide(data.guide as unknown as Guide))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const saveNotes = async () => {
    if (!luckPerms) return;
    setSaving(true);
    try {
      await api.updatePluginNotes(project.id, luckPerms.id, notes);
      toast.success(t('toast.notesSaved'));
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (error) return <WarningList warnings={[error]} tone="error" />;
  if (!guide) return <Spinner label={t('common.loading')} />;

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">{t('luck.title')}</h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">{guide.summary}</p>
          </div>
          <div className="shrink-0">
            {luckPerms ? (
              <div className="text-right">
                <div className="badge badge-verified">{luckPerms.version ?? 'installed'}</div>
                <div className="mt-1 text-[11px] text-slate-500">Needs {luckPerms.configDir}/config.yml</div>
              </div>
            ) : (
              <span className="badge badge-unknown">{t('luck.notInstalled')}</span>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {guide.docs.map((doc) => (
            <a key={doc.url} href={doc.url} target="_blank" rel="noreferrer" className="chip hover:border-accent/60 hover:text-slate-100">
              {doc.label} <Icon name="external" size={10} />
            </a>
          ))}
          {luckPerms ? (
            <Link to={`/editor?project=${project.id}&plugin=${luckPerms.id}`} className="btn btn-xs btn-secondary">
              <Icon name="sliders" size={12} /> {t('luck.openConfig')}
            </Link>
          ) : null}
        </div>
        <div className="mt-3">
          <WarningList warnings={guide.warnings} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card">
          <div className="card-header">
            <h4 className="text-sm font-semibold text-slate-200">{t('luck.commands')}</h4>
            <span className="text-[10px] text-slate-500">In-game</span>
          </div>
          <ul className="divide-y divide-surface-800">
            {guide.inGameCommands.map((command) => (
              <li key={command.command} className="flex items-start gap-2 px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-emerald-300">{command.command}</code>
                <span className="hidden max-w-[55%] text-[11px] text-slate-500 sm:block">{command.description}</span>
                <CopyButton value={command.command} label={t('common.copy')} />
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="card-header">
            <h4 className="text-sm font-semibold text-slate-200">{t('luck.nodes')}</h4>
            <span className="text-[10px] text-slate-500">Examples</span>
          </div>
          <ul className="divide-y divide-surface-800">
            {guide.permissionNodes.map((node) => (
              <li key={node.node} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <code className="font-mono text-[11px] text-sky-300">{node.node}</code>
                  <CopyButton value={node.node} />
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {node.description} <span className="text-slate-600">· {node.plugin}</span>
                </p>
              </li>
            ))}
          </ul>
          <p className="border-t border-surface-800 px-3 py-2 text-[11px] text-slate-500">
            Permission nodes vary by plugin version. Verify in-game with <code className="font-mono">/lp verbose on</code>.
          </p>
        </section>
      </div>

      <section className="card p-4">
        <h4 className="text-sm font-semibold text-slate-200">{t('luck.roles')}</h4>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {guide.rolePlanning.map((plan) => (
            <div key={plan.title} className="rounded-md border border-surface-700 bg-surface-850/40 p-3">
              <h5 className="text-xs font-medium text-slate-200">{plan.title}</h5>
              <ul className="mt-1.5 space-y-1 text-[11px] text-slate-400">
                {plan.notes.map((note) => (
                  <li key={note} className="flex gap-1.5">
                    <span className="text-slate-600">–</span>
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h4 className="text-sm font-semibold text-slate-200">{t('luck.config')}</h4>
        <ul className="mt-2 space-y-1 text-xs text-slate-400">
          {guide.configFiles.map((file) => (
            <li key={file.path} className="flex flex-wrap gap-2">
              <code className="font-mono text-slate-300">{file.path}</code>
              <span>{file.note}</span>
            </li>
          ))}
        </ul>
        {luckPerms ? (
          <div className="mt-3">
            <label className="label" htmlFor="lp-notes">
              {t('common.notes')}
            </label>
            <textarea id="lp-notes" className="textarea" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Rank plan, staff groups, prefix decisions…" />
            <div className="mt-2 flex justify-end">
              <button type="button" className="btn btn-secondary btn-xs" onClick={saveNotes} disabled={saving || notes === (luckPerms.notes ?? '')}>
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <EmptyState title={t('luck.notInstalled')} description="Add LuckPerms from the Plugins tab, then return here for guidance." icon="shield" />
          </div>
        )}
      </section>
    </div>
  );
}
