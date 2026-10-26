import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, type TabContext, type TabModel } from '../api';
import { McText, parseMinecraft } from './format';
import { ConfirmDialog, ErrorBanner, Field, Icon, InlineError, LoadingBlock, Modal, Spinner, Toggle, WarningList } from './ui';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from './Toast';

interface PreviewPlayer {
  id: string;
  username: string;
  prefix: string;
  suffix: string;
  ping: number;
  color: string;
}

const DEFAULT_PLAYERS: PreviewPlayer[] = [
  { id: '1', username: 'Steve', prefix: '&a[VIP] ', suffix: '', ping: 23, color: '&a' },
  { id: '2', username: 'Alex', prefix: '&7', suffix: '', ping: 51, color: '&7' },
  { id: '3', username: 'Notch', prefix: '&c[ADMIN] ', suffix: ' &8⚑', ping: 12, color: '&c' },
  { id: '4', username: 'Herobrine', prefix: '', suffix: '', ping: 143, color: '&f' },
];

const PLACEHOLDERS = [
  '%player%',
  '%player_name%',
  '%displayname%',
  '%ping%',
  '%health%',
  '%level%',
  '%world%',
  '%server_online%',
  '%server_max_players%',
  '%luckperms_prefix%',
  '%luckperms_suffix%',
  '%luckperms_primary_group_name%',
  '%vault_eco_balance%',
];

interface HistoryEntry {
  model: TabModel;
  extra: Record<string, unknown>;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function interpolate(template: string, player: PreviewPlayer, model: TabModel): string {
  return template
    .replaceAll('%player%', player.username)
    .replaceAll('%player_name%', player.username)
    .replaceAll('%displayname%', `${player.prefix}${player.username}${player.suffix}`)
    .replaceAll('%luckperms_prefix%', player.prefix)
    .replaceAll('%luckperms_suffix%', player.suffix)
    .replaceAll('%ping%', String(player.ping))
    .replaceAll('%server_online%', String(DEFAULT_PLAYERS.length))
    .replaceAll('%server_max_players%', '100')
    .replaceAll('%level%', '30')
    .replaceAll('%world%', 'world')
    .replaceAll('%health%', '20')
    .replaceAll('%luckperms_primary_group_name%', 'default')
    .replaceAll('%vault_eco_balance%', '1250');
}

function listValues(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function LineList({
  lines,
  onChange,
  placeholder,
  registerFocus,
  addLabel,
}: {
  lines: string[];
  onChange: (lines: string[]) => void;
  placeholder: string;
  registerFocus?: (apply: (token: string) => void) => void;
  addLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      {lines.map((line, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            className="input code-font py-1.5"
            value={line}
            placeholder={placeholder}
            onFocus={() => registerFocus?.((token) => onChange(lines.map((value, i) => (i === index ? value + token : value))))}
            onChange={(event) => onChange(lines.map((value, i) => (i === index ? event.target.value : value)))}
          />
          <button
            type="button"
            className="btn btn-xs btn-ghost shrink-0 text-slate-500 hover:text-red-300"
            aria-label="Remove line"
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-xs btn-secondary" onClick={() => onChange([...lines, ''])}>
        <Icon name="plus" size={11} /> {addLabel}
      </button>
    </div>
  );
}

export default function TabEditor({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const toast = useToast();

  const [model, setModel] = useState<TabModel | null>(null);
  const [extraSections, setExtraSections] = useState<Record<string, unknown>>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const [context, setContext] = useState<TabContext | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [players, setPlayers] = useState<PreviewPlayer[]>(DEFAULT_PLAYERS);
  const [sidebarLines, setSidebarLines] = useState<string[]>(['&6&lHamburgerSMP', '&7──────────', '&fOnline: &a%server_online%', '&fPing: &a%ping%ms', '', '&eplay.example.com']);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlPreview, setYamlPreview] = useState('');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const focusApply = useRef<((token: string) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.tabModel(), api.tabContext(projectId)])
      .then(([modelData, contextData]) => {
        if (cancelled) return;
        setModel(modelData.model);
        setContext(contextData);
        if (contextData.existingConfig) {
          api
            .tabParse(contextData.existingConfig.content)
            .then((parsed) => {
              if (cancelled) return;
              setModel(parsed.model);
              setExtraSections(parsed.extraSections);
              setWarnings(parsed.warnings);
            })
            .catch((err) => setWarnings([`Existing TAB config could not be parsed: ${errorMessage(err)}`]));
        }
      })
      .catch((err) => setLoadError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const update = (producer: (current: TabModel) => TabModel) => {
    setModel((current) => {
      if (!current) return current;
      const next = producer(deepClone(current));
      setHistory((prev) => [...prev.slice(-49), { model: current, extra: extraSections }]);
      setFuture([]);
      return next;
    });
  };

  const undo = () => {
    if (history.length === 0 || !model) return;
    const entry = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setFuture([...future, { model, extra: extraSections }]);
    setModel(entry.model);
    setExtraSections(entry.extra);
  };

  const redo = () => {
    if (future.length === 0 || !model) return;
    const entry = future[future.length - 1];
    setFuture(future.slice(0, -1));
    setHistory([...history, { model, extra: extraSections }]);
    setModel(entry.model);
    setExtraSections(entry.extra);
  };

  const releaseFocus = (token: string) => {
    if (focusApply.current) focusApply.current(token);
    else toast.info('Focus a line first, then insert a placeholder.');
  };

  const validate = async () => {
    if (!model) return;
    try {
      const result = await api.tabValidate(model, extraSections);
      setWarnings(result.warnings);
      toast[result.valid ? 'success' : 'error'](result.valid ? t('editor.valid') : result.error ?? t('editor.invalid'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const generate = async (): Promise<string | null> => {
    if (!model) return null;
    try {
      const result = await api.tabGenerate(model, extraSections);
      setWarnings(result.warnings);
      return result.content;
    } catch (err) {
      toast.error(errorMessage(err));
      return null;
    }
  };

  const downloadYaml = async () => {
    const content = await generate();
    if (!content) return;
    const blob = new Blob([content], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'config.yml';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const previewYaml = async () => {
    const content = await generate();
    if (content) {
      setYamlPreview(content);
      setYamlOpen(true);
    }
  };

  const saveToProject = async () => {
    setBusy(true);
    try {
      const content = await generate();
      if (!content) return;
      await api.tabSave(projectId, content);
      toast.success(t('tab.saved'));
      setConfirmOverwrite(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const loadExisting = async () => {
    if (!context?.existingConfig) {
      toast.info('There is no saved TAB/config.yml in this project yet.');
      return;
    }
    try {
      const parsed = await api.tabParse(context.existingConfig.content);
      setHistory((prev) => [...prev, { model: model!, extra: extraSections }]);
      setFuture([]);
      setModel(parsed.model);
      setExtraSections(parsed.extraSections);
      setWarnings(parsed.warnings);
      toast.success(t('tab.import')); 
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const applyImport = async () => {
    try {
      const parsed = await api.tabParse(importText);
      setHistory((prev) => [...prev, { model: model!, extra: extraSections }]);
      setFuture([]);
      setModel(parsed.model);
      setExtraSections(parsed.extraSections);
      setImportWarnings(parsed.warnings);
      setImportOpen(false);
      toast.success(t('tab.import'));
    } catch (err) {
      setImportWarnings([errorMessage(err)]);
    }
  };

  const previewRows = useMemo(() => {
    if (!model) return [];
    const formatLines = model.tablistNameFormatting.enabled ? model.tablistNameFormatting.format : ['%player%'];
    return players.map((player) => {
      const name = formatLines.map((line) => interpolate(line, player, model)).join(' ');
      return { player, name };
    });
  }, [players, model]);

  if (loadError) return <ErrorBanner message={loadError} onRetry={() => window.location.reload()} />;
  if (!model) return <LoadingBlock label={t('common.loading')} />;

  const adapterUnsupported = context?.adapter && !context.adapter.supported;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-xs btn-secondary" onClick={undo} disabled={history.length === 0} title={t('tab.undo')}>
            <Icon name="undo" size={12} /> {t('tab.undo')}
          </button>
          <button type="button" className="btn btn-xs btn-secondary" onClick={redo} disabled={future.length === 0} title={t('tab.redo')}>
            <Icon name="redo" size={12} /> {t('tab.redo')}
          </button>
        </div>
        <span className={`badge ${adapterUnsupported ? 'badge-incompatible' : 'badge-verified'}`}>
          {t('tab.versionNotice')}: TAB {context?.tabVersion ?? '5.x'}
        </span>
        {context?.existingConfig ? <span className="badge badge-unknown">{t('editor.saved')}</span> : null}
        <div className="ml-auto flex flex-wrap gap-1">
          <button type="button" className="btn btn-xs btn-secondary" onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={12} /> {t('tab.import')}
          </button>
          {context?.existingConfig ? (
            <button type="button" className="btn btn-xs btn-secondary" onClick={loadExisting}>
              <Icon name="refresh" size={12} /> {t('common.refresh')}
            </button>
          ) : null}
          <button type="button" className="btn btn-xs btn-secondary" onClick={validate}>
            <Icon name="shield" size={12} /> {t('editor.validate')}
          </button>
          <button type="button" className="btn btn-xs btn-secondary" onClick={previewYaml}>
            <Icon name="file" size={12} /> YAML
          </button>
          <button type="button" className="btn btn-xs btn-secondary" onClick={downloadYaml}>
            <Icon name="download" size={12} /> {t('tab.export')}
          </button>
          <button type="button" className="btn btn-xs btn-primary" onClick={() => (context?.existingConfig ? setConfirmOverwrite(true) : saveToProject())} disabled={busy}>
            {busy ? t('common.saving') : t('tab.saveToProject')}
          </button>
        </div>
      </div>

      {adapterUnsupported ? <WarningList warnings={[context!.adapter.message]} tone="error" /> : context?.adapter ? <p className="text-xs text-slate-500">{context.adapter.message}</p> : null}
      {warnings.length > 0 ? <WarningList warnings={warnings} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          <section className="card p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">{t('tab.header')} / {t('tab.footer')}</h3>
              <span className="text-[11px] text-slate-500">{t('tab.hexHint')}</span>
            </div>
            <div className="space-y-3">
              <Toggle checked={model.headerFooter.enabled} onChange={(value) => update((m) => ({ ...m, headerFooter: { ...m.headerFooter, enabled: value } }))} label={t('common.enabled')} />
              <Field label={t('tab.header')}>
                <LineList
                  lines={model.headerFooter.header}
                  onChange={(lines) => update((m) => ({ ...m, headerFooter: { ...m.headerFooter, header: lines } }))}
                  placeholder="&6&lMy Server"
                  addLabel={t('tab.addLine')}
                  registerFocus={(apply) => (focusApply.current = apply)}
                />
              </Field>
              <Field label={t('tab.footer')}>
                <LineList
                  lines={model.headerFooter.footer}
                  onChange={(lines) => update((m) => ({ ...m, headerFooter: { ...m.headerFooter, footer: lines } }))}
                  placeholder="&7play.example.com"
                  addLabel={t('tab.addLine')}
                  registerFocus={(apply) => (focusApply.current = apply)}
                />
              </Field>
            </div>
          </section>

          <section className="card p-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-200">{t('tab.playerList')}</h3>
            <div className="space-y-3">
              <Toggle checked={model.tablistNameFormatting.enabled} onChange={(value) => update((m) => ({ ...m, tablistNameFormatting: { ...m.tablistNameFormatting, enabled: value } }))} label={t('tab.nameFormat')} />
              <LineList
                lines={model.tablistNameFormatting.format}
                onChange={(lines) => update((m) => ({ ...m, tablistNameFormatting: { ...m.tablistNameFormatting, format: lines.length ? lines : ['%player%'] } }))}
                placeholder="%luckperms_prefix%&f%player%"
                addLabel={t('tab.addLine')}
                registerFocus={(apply) => (focusApply.current = apply)}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle checked={model.scoreboardTeams.enabled} onChange={(value) => update((m) => ({ ...m, scoreboardTeams: { ...m.scoreboardTeams, enabled: value } }))} label={t('tab.scoreboard')} />
                <Toggle checked={model.playerlistObjective.enabled} onChange={(value) => update((m) => ({ ...m, playerlistObjective: { ...m.playerlistObjective, enabled: value } }))} label={t('tab.statusLine')} />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label={t('tab.nameFormat')}>
                  <input className="input" value={model.scoreboardTeams.format} onChange={(event) => update((m) => ({ ...m, scoreboardTeams: { ...m.scoreboardTeams, format: event.target.value } }))} />
                </Field>
                <Field label={t('common.category')}>
                  <select className="select" value={model.scoreboardTeams.collisionRule} onChange={(event) => update((m) => ({ ...m, scoreboardTeams: { ...m.scoreboardTeams, collisionRule: event.target.value as TabModel['scoreboardTeams']['collisionRule'] } }))}>
                    {['pushOtherTeams', 'pushOwnTeam', 'alwaysPush', 'neverPush'].map((rule) => (
                      <option key={rule} value={rule}>
                        {rule}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Team name format">
                  <input className="input" value={model.scoreboardTeams.teamNameFormat} onChange={(event) => update((m) => ({ ...m, scoreboardTeams: { ...m.scoreboardTeams, teamNameFormat: event.target.value } }))} />
                </Field>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle checked={model.scoreboardTeams.caseSensitiveSorting} onChange={(value) => update((m) => ({ ...m, scoreboardTeams: { ...m.scoreboardTeams, caseSensitiveSorting: value } }))} label="Case sensitive sorting" />
                <Toggle checked={model.scoreboardTeams.disableCollision} onChange={(value) => update((m) => ({ ...m, scoreboardTeams: { ...m.scoreboardTeams, disableCollision: value } }))} label="Disable collision" />
                <Toggle checked={model.scoreboardTeams.invisibleTeamNames} onChange={(value) => update((m) => ({ ...m, scoreboardTeams: { ...m.scoreboardTeams, invisibleTeamNames: value } }))} label="Invisible team names" />
                <Toggle checked={model.scoreboardTeams.unlimitedNametagLength} onChange={(value) => update((m) => ({ ...m, scoreboardTeams: { ...m.scoreboardTeams, unlimitedNametagLength: value } }))} label="Unlimited nametag length" />
              </div>
              <Field label={t('tab.teams')} hint="Example: GROUPS:owner or PLACEHOLDER_A_TO_Z:%player%">
                <LineList
                  lines={model.scoreboardTeams.sortingTypes}
                  onChange={(lines) => update((m) => ({ ...m, scoreboardTeams: { ...m.scoreboardTeams, sortingTypes: lines } }))}
                  placeholder="GROUPS:owner"
                  addLabel={t('common.add')}
                  registerFocus={(apply) => (focusApply.current = apply)}
                />
              </Field>
            </div>
          </section>

          <section className="card p-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-200">{t('tab.objective')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 rounded-md border border-surface-700 p-2.5">
                <Toggle checked={model.playerlistObjective.enabled} onChange={(value) => update((m) => ({ ...m, playerlistObjective: { ...m.playerlistObjective, enabled: value } }))} label="Player list objective" />
                <Field label="Title">
                  <input className="input" value={model.playerlistObjective.title} onChange={(event) => update((m) => ({ ...m, playerlistObjective: { ...m.playerlistObjective, title: event.target.value } }))} />
                </Field>
                <Field label="Value">
                  <input className="input code-font" value={model.playerlistObjective.value} onChange={(event) => update((m) => ({ ...m, playerlistObjective: { ...m.playerlistObjective, value: event.target.value } }))} />
                </Field>
                <Field label="Render type">
                  <select className="select" value={model.playerlistObjective.renderType} onChange={(event) => update((m) => ({ ...m, playerlistObjective: { ...m.playerlistObjective, renderType: event.target.value as 'INTEGER' | 'HEARTS' } }))}>
                    <option value="INTEGER">INTEGER</option>
                    <option value="HEARTS">HEARTS</option>
                  </select>
                </Field>
              </div>
              <div className="space-y-2 rounded-md border border-surface-700 p-2.5">
                <Toggle checked={model.belownameObjective.enabled} onChange={(value) => update((m) => ({ ...m, belownameObjective: { ...m.belownameObjective, enabled: value } }))} label={t('tab.belowName')} />
                <Field label="Title">
                  <input className="input" value={model.belownameObjective.title} onChange={(event) => update((m) => ({ ...m, belownameObjective: { ...m.belownameObjective, title: event.target.value } }))} />
                </Field>
                <Field label="Value">
                  <input className="input code-font" value={model.belownameObjective.value} onChange={(event) => update((m) => ({ ...m, belownameObjective: { ...m.belownameObjective, value: event.target.value } }))} />
                </Field>
                <Field label="Render type">
                  <select className="select" value={model.belownameObjective.renderType} onChange={(event) => update((m) => ({ ...m, belownameObjective: { ...m.belownameObjective, renderType: event.target.value as 'INTEGER' | 'HEARTS' } }))}>
                    <option value="INTEGER">INTEGER</option>
                    <option value="HEARTS">HEARTS</option>
                  </select>
                </Field>
              </div>
            </div>
          </section>

          <section className="card p-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-200">{t('tab.bossbar')}</h3>
            <div className="space-y-2">
              <Toggle checked={model.bossbar.enabled} onChange={(value) => update((m) => ({ ...m, bossbar: { ...m.bossbar, enabled: value } }))} label={t('common.enabled')} />
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Style">
                  <select className="select" value={model.bossbar.style} onChange={(event) => update((m) => ({ ...m, bossbar: { ...m.bossbar, style: event.target.value as TabModel['bossbar']['style'] } }))}>
                    {['PROGRESS', 'NOTCHED_6', 'NOTCHED_10', 'NOTCHED_12', 'NOTCHED_20'].map((style) => (
                      <option key={style}>{style}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Color">
                  <select className="select" value={model.bossbar.color} onChange={(event) => update((m) => ({ ...m, bossbar: { ...m.bossbar, color: event.target.value as TabModel['bossbar']['color'] } }))}>
                    {['PINK', 'BLUE', 'RED', 'GREEN', 'YELLOW', 'PURPLE', 'WHITE'].map((color) => (
                      <option key={color}>{color}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Progress">
                  <input className="input" value={model.bossbar.progress} onChange={(event) => update((m) => ({ ...m, bossbar: { ...m.bossbar, progress: event.target.value } }))} />
                </Field>
              </div>
              <Field label="Text">
                <input className="input code-font" value={model.bossbar.text} onChange={(event) => update((m) => ({ ...m, bossbar: { ...m.bossbar, text: event.target.value } }))} />
              </Field>
            </div>
          </section>

          <section className="card p-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-200">{t('tab.placeholders')}</h3>
            <div className="flex flex-wrap gap-1">
              {PLACEHOLDERS.map((token) => (
                <button key={token} type="button" className="chip hover:border-accent/60 hover:text-slate-100" onClick={() => releaseFocus(token)}>
                  {token}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Field label="Date format">
                <input className="input" value={model.placeholders.dateFormat} onChange={(event) => update((m) => ({ ...m, placeholders: { ...m.placeholders, dateFormat: event.target.value } }))} />
              </Field>
              <Field label="Time format">
                <input className="input" value={model.placeholders.timeFormat} onChange={(event) => update((m) => ({ ...m, placeholders: { ...m.placeholders, timeFormat: event.target.value } }))} />
              </Field>
              <Field label="Time offset (hours)">
                <input type="number" min={-24} max={24} className="input" value={model.placeholders.timeOffset} onChange={(event) => update((m) => ({ ...m, placeholders: { ...m.placeholders, timeOffset: Number(event.target.value) || 0 } }))} />
              </Field>
            </div>
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="label mb-0">Placeholder output replacements</span>
                <button type="button" className="btn btn-xs btn-secondary" onClick={() => update((m) => ({ ...m, outputReplacements: [...m.outputReplacements, { placeholder: '', replacement: '' }] }))}>
                  <Icon name="plus" size={11} />
                </button>
              </div>
              {model.outputReplacements.map((row, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                  <input className="input code-font py-1" placeholder="%server_online%" value={row.placeholder} onChange={(event) => update((m) => ({ ...m, outputReplacements: m.outputReplacements.map((item, i) => (i === index ? { ...item, placeholder: event.target.value } : item)) }))} />
                  <input className="input py-1" placeholder="&4No players online" value={row.replacement} onChange={(event) => update((m) => ({ ...m, outputReplacements: m.outputReplacements.map((item, i) => (i === index ? { ...item, replacement: event.target.value } : item)) }))} />
                  <button type="button" className="btn btn-xs btn-ghost text-slate-500 hover:text-red-300" onClick={() => update((m) => ({ ...m, outputReplacements: m.outputReplacements.filter((_, i) => i !== index) }))}>
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Toggle checked={model.spectatorsDisabled} onChange={(value) => update((m) => ({ ...m, spectatorsDisabled: value }))} label="Prevent spectator effect" />
            </div>
          </section>

          <section className="card p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">{t('tab.players')}</h3>
              <button
                type="button"
                className="btn btn-xs btn-secondary"
                onClick={() => setPlayers((prev) => [...prev, { id: Math.random().toString(36).slice(2), username: `Player${prev.length + 1}`, prefix: '', suffix: '', ping: 40, color: '&f' }])}
              >
                <Icon name="plus" size={11} /> {t('tab.addPlayer')}
              </button>
            </div>
            <div className="space-y-2">
              {players.map((player, index) => (
                <div key={player.id} className="grid gap-1.5 sm:grid-cols-[1fr_1fr_1fr_70px_auto]">
                  <input className="input py-1 text-xs" value={player.username} aria-label={t('tab.username')} onChange={(event) => setPlayers((prev) => prev.map((p, i) => (i === index ? { ...p, username: event.target.value } : p)))} />
                  <input className="input py-1 text-xs" value={player.prefix} aria-label={t('tab.prefix')} onChange={(event) => setPlayers((prev) => prev.map((p, i) => (i === index ? { ...p, prefix: event.target.value } : p)))} />
                  <input className="input py-1 text-xs" value={player.suffix} aria-label={t('tab.suffix')} onChange={(event) => setPlayers((prev) => prev.map((p, i) => (i === index ? { ...p, suffix: event.target.value } : p)))} />
                  <input type="number" className="input py-1 text-xs" value={player.ping} aria-label="Ping" onChange={(event) => setPlayers((prev) => prev.map((p, i) => (i === index ? { ...p, ping: Number(event.target.value) || 0 } : p)))} />
                  <button type="button" className="btn btn-xs btn-ghost text-slate-500 hover:text-red-300" onClick={() => setPlayers((prev) => prev.filter((_, i) => i !== index))}>
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-3">
          <div className="sticky top-16 space-y-3">
            <section className="card overflow-hidden">
              <div className="card-header">
                <h3 className="text-sm font-semibold text-slate-200">{t('common.preview')}</h3>
                <span className="text-[10px] text-slate-500">TAB {context?.tabVersion ?? '5.x'}</span>
              </div>
              <div className="bg-[#0a0a0a] p-2">
                <div className="rounded border border-[#222] bg-[#111] p-2">
                  {model.headerFooter.enabled && model.headerFooter.header.length > 0 ? (
                    <div className="mb-1 space-y-0.5 text-center font-mono text-[11px] leading-tight">
                      {model.headerFooter.header.map((line, index) => (
                        <div key={index}>
                          <McText
                            text={interpolate(line, players[0] ?? DEFAULT_PLAYERS[0], model)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="divide-y divide-[#1d1d1d] text-[11px] font-mono">
                    {previewRows.map(({ player, name }) => {
                      const objectiveValue = model.playerlistObjective.enabled
                        ? interpolate(model.playerlistObjective.value, player, model).replace('%ping%', String(player.ping))
                        : '';
                      return (
                        <div key={player.id} className="flex items-center justify-between gap-2 px-1 py-1">
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: parseMinecraft(player.prefix || player.color)[0]?.color ?? '#888' }} />
                            <McText text={name} />
                          </span>
                          {model.playerlistObjective.enabled ? (
                            <span className="shrink-0 text-[#ff5555]">
                              {model.playerlistObjective.renderType === 'HEARTS' ? '❤'.repeat(Math.max(0, Math.min(10, Math.round(player.ping / 20)))) : objectiveValue}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {model.headerFooter.enabled && model.headerFooter.footer.length > 0 ? (
                    <div className="mt-1 space-y-0.5 text-center font-mono text-[11px] leading-tight">
                      {model.headerFooter.footer.map((line, index) => (
                        <div key={index}>
                          <McText text={interpolate(line, players[0] ?? DEFAULT_PLAYERS[0], model)} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {model.playerlistObjective.enabled ? (
                    <div className="mt-1 border-t border-[#1d1d1d] pt-1 text-[10px] text-[#aaa]">
                      {t('tab.statusLine')}: <span className="text-[#ff5555]">{model.playerlistObjective.title}</span>
                    </div>
                  ) : null}
                </div>
                <p className="mt-1 px-1 text-[10px] text-slate-500">{t('tab.previewNote')}</p>
              </div>
            </section>

            {model.bossbar.enabled ? (
              <section className="card p-2">
                <div className="rounded border border-[#222] bg-[#0a0a0a] p-2">
                  <div className="mb-1 text-center font-mono text-[11px]">
                    <McText text={interpolate(model.bossbar.text, players[0] ?? DEFAULT_PLAYERS[0], model)} />
                  </div>
                  <div className="h-2 overflow-hidden rounded-sm bg-[#222]">
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.min(100, Math.max(0, Number(model.bossbar.progress) || 0))}%`,
                        background: { PINK: '#ff55ff', BLUE: '#5555ff', RED: '#ff5555', GREEN: '#55ff55', YELLOW: '#ffff55', PURPLE: '#aa00aa', WHITE: '#ffffff' }[model.bossbar.color],
                      }}
                    />
                  </div>
                </div>
              </section>
            ) : null}

            <section className="card p-2">
              <div className="mb-1 flex items-center justify-between px-1">
                <h3 className="text-xs font-semibold text-slate-300">{t('tab.sidebar')}</h3>
                <button type="button" className="btn btn-xs btn-ghost" onClick={() => setSidebarLines((prev) => [...prev, ''])}>
                  <Icon name="plus" size={11} />
                </button>
              </div>
              <div className="rounded border border-[#222] bg-[#0a0a0a] p-2">
                <div className="w-full max-w-[220px] bg-[#111] p-1.5 font-mono text-[10px]">
                  {sidebarLines.map((line, index) => (
                    <div key={index} className="flex items-center justify-between gap-1">
                      <McText text={interpolate(line, players[0] ?? DEFAULT_PLAYERS[0], model)} />
                      <span className="text-[#ff5555]">{15 - index}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-1 px-1 text-[10px] text-slate-500">{t('tab.sidebarNote')}</p>
              <div className="mt-1 space-y-1">
                {sidebarLines.map((line, index) => (
                  <div key={index} className="flex gap-1">
                    <input className="input code-font py-0.5 text-[11px]" value={line} onChange={(event) => setSidebarLines((prev) => prev.map((value, i) => (i === index ? event.target.value : value)))} />
                    <button type="button" className="btn btn-xs btn-ghost" onClick={() => setSidebarLines((prev) => prev.filter((_, i) => i !== index))}>
                      <Icon name="x" size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {extraSections && Object.keys(extraSections).length > 0 ? (
              <section className="card p-3 text-xs text-slate-400">
                <h3 className="mb-1 font-semibold text-slate-300">{t('tab.extraSections')}</h3>
                <p className="font-mono text-[11px]">{Object.keys(extraSections).join(', ')}</p>
                <p className="mt-1">{t('editor.previewNote')}</p>
              </section>
            ) : null}
          </div>
        </div>
      </div>

      <Modal
        open={importOpen}
        title={t('tab.import')}
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={applyImport} disabled={!importText.trim()}>
              {t('common.apply')}
            </button>
          </>
        }
      >
        <p className="mb-2 text-xs text-slate-400">{t('tab.importHint')}</p>
        <textarea className="textarea code-font" rows={14} value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={`header-footer:\n  enabled: true\n  header:\n    - "&6My Server"`} />
        {importWarnings.length > 0 ? (
          <div className="mt-2">
            <WarningList warnings={importWarnings} />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={yamlOpen}
        title="Generated TAB config.yml"
        onClose={() => setYamlOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setYamlOpen(false)}>
              {t('common.close')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                await navigator.clipboard.writeText(yamlPreview).catch(() => undefined);
                toast.success(t('toast.copied'));
              }}
            >
              {t('common.copy')}
            </button>
          </>
        }
      >
        <pre className="code-font max-h-[55vh] overflow-auto rounded border border-surface-700 bg-surface-950 p-3 text-slate-300">{yamlPreview}</pre>
      </Modal>

      <ConfirmDialog
        open={confirmOverwrite}
        title={t('tab.saveToProject')}
        message="This project already has TAB/config.yml. Overwrite it with the generated configuration?"
        confirmLabel={t('common.save')}
        busy={busy}
        onCancel={() => setConfirmOverwrite(false)}
        onConfirm={saveToProject}
      >
        <p className="text-xs text-slate-500">A copy of the previous content is not kept automatically; use the config editor to copy it first if needed.</p>
      </ConfirmDialog>
    </div>
  );
}
