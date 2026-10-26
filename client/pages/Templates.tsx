import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { useToast, errorMessage } from '../components/Toast';
import {
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  Field,
  Icon,
  LoadingBlock,
  Modal,
  PageHeader,
  WarningList,
} from '../components/ui';
import TemplateApplyDialog from '../components/TemplateApplyDialog';
import type { Project, ServerSoftware, ServerTemplate, TemplatePluginRef } from '../../shared/types';

interface RefRow {
  name: string;
  modrinthSlug: string;
  required: boolean;
}

interface FormState {
  name: string;
  description: string;
  categories: string;
  mcVersions: string;
  software: '' | ServerSoftware;
  notes: string;
  warnings: string;
  refs: RefRow[];
}

const EMPTY: FormState = {
  name: '',
  description: '',
  categories: '',
  mcVersions: '',
  software: '',
  notes: '',
  warnings: '',
  refs: [{ name: '', modrinthSlug: '', required: true }],
};

export default function Templates() {
  const { t, lang } = useI18n();
  const toast = useToast();

  const [templates, setTemplates] = useState<ServerTemplate[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState<ServerTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerTemplate | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ServerTemplate | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([api.templates(), api.listProjects()])
      .then(([templateData, projectData]) => {
        setTemplates(templateData.templates);
        setProjects(projectData.projects);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setEditorOpen(true);
  };

  const openEdit = (template: ServerTemplate) => {
    setEditing(template);
    setForm({
      name: template.name,
      description: template.description,
      categories: template.categories.join(', '),
      mcVersions: template.mcVersions.join(', '),
      software: template.software ?? '',
      notes: template.notes,
      warnings: template.warnings.join('\n'),
      refs: template.plugins.map((ref) => ({ name: ref.name, modrinthSlug: ref.modrinthSlug ?? ref.slug ?? '', required: ref.required })),
    });
    setFormError(null);
    setEditorOpen(true);
  };

  const submit = async () => {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Template name is required.');
      return;
    }
    const refs: TemplatePluginRef[] = form.refs
      .filter((ref) => ref.name.trim() !== '')
      .map((ref) => ({
        name: ref.name.trim(),
        modrinthSlug: ref.modrinthSlug.trim() || undefined,
        required: ref.required,
      }));
    const payload = {
      name: form.name.trim(),
      description: form.description,
      categories: form.categories.split(',').map((c) => c.trim()).filter(Boolean),
      mcVersions: form.mcVersions.split(',').map((c) => c.trim()).filter(Boolean),
      software: form.software === '' ? null : form.software,
      plugins: refs,
      warnings: form.warnings.split('\n').map((w) => w.trim()).filter(Boolean),
      notes: form.notes,
    };
    setBusy(true);
    try {
      if (editing) await api.updateTemplate(editing.id, payload);
      else await api.createTemplate(payload);
      toast.success(t('common.saved'));
      setEditorOpen(false);
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (template: ServerTemplate) => {
    try {
      await api.duplicateTemplate(template.id);
      toast.success(t('common.duplicate'));
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.deleteTemplate(deleteTarget.id);
      setDeleteTarget(null);
      toast.success(t('common.delete'));
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('templates.title')}
        subtitle={t('templates.subtitle')}
        actions={
          <button type="button" className="btn btn-primary btn-xs" onClick={openCreate}>
            <Icon name="plus" size={13} /> {t('templates.create')}
          </button>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {loading ? (
        <LoadingBlock label={t('common.loading')} />
      ) : templates.length === 0 ? (
        <EmptyState title={t('templates.noTemplates')} icon="layers" action={<button type="button" className="btn btn-primary btn-xs" onClick={openCreate}>{t('templates.create')}</button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <article key={template.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-slate-100">{template.name}</h2>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{template.description || '—'}</p>
                </div>
                <span className={`badge shrink-0 ${template.builtin ? 'badge-unknown' : 'badge-verified'}`}>
                  {template.builtin ? t('templates.builtin') : t('templates.custom')}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {template.software ? <span className="chip">{template.software}</span> : null}
                {template.mcVersions.slice(0, 3).map((version) => (
                  <span key={version} className="chip">
                    {version}
                  </span>
                ))}
                <span className="chip">{template.plugins.length} plugins</span>
              </div>
              {template.categories.length > 0 ? (
                <p className="mt-2 text-[11px] text-slate-500">{template.categories.join(' · ')}</p>
              ) : null}
              <div className="mt-auto flex flex-wrap gap-1 pt-3">
                <button type="button" className="btn btn-xs btn-primary" onClick={() => setApplyTarget(template)}>
                  {t('templates.apply')}
                </button>
                <button type="button" className="btn btn-xs btn-secondary" onClick={() => openEdit(template)}>
                  <Icon name="edit" size={11} /> {template.builtin ? t('templates.preview') : t('templates.edit')}
                </button>
                <button type="button" className="btn btn-xs btn-ghost" onClick={() => duplicate(template)} title={t('templates.duplicate')}>
                  <Icon name="copy" size={12} />
                </button>
                {!template.builtin ? (
                  <button type="button" className="btn btn-xs btn-ghost text-red-300" onClick={() => setDeleteTarget(template)} title={t('templates.delete')}>
                    <Icon name="trash" size={12} />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <TemplateApplyDialog
        open={Boolean(applyTarget)}
        onClose={() => setApplyTarget(null)}
        projects={projects}
        initialTemplateId={applyTarget?.id}
        onApplied={load}
      />

      <Modal
        open={editorOpen}
        title={editing ? `${t('templates.edit')} — ${editing.name}` : t('templates.create')}
        onClose={() => setEditorOpen(false)}
        width="max-w-3xl"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditorOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || (Boolean(editing?.builtin) && false)}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </>
        }
      >
        {editing?.builtin ? (
          <p className="mb-2 text-xs text-amber-200">Built-in templates cannot be edited. Duplicate this template to customise it.</p>
        ) : null}
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('common.name')}>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={editing?.builtin} />
            </Field>
            <Field label={t('wizard.software')}>
              <select className="select" value={form.software} onChange={(e) => setForm({ ...form, software: e.target.value as FormState['software'] })} disabled={editing?.builtin}>
                <option value="">—</option>
                <option value="paper">paper</option>
                <option value="folia">folia</option>
                <option value="leaf">leaf</option>
              </select>
            </Field>
          </div>
          <Field label={t('common.description')}>
            <textarea className="textarea" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={editing?.builtin} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('common.categories')} hint="Comma separated">
              <input className="input" value={form.categories} onChange={(e) => setForm({ ...form, categories: e.target.value })} disabled={editing?.builtin} />
            </Field>
            <Field label="Minecraft versions" hint="Comma separated">
              <input className="input" value={form.mcVersions} onChange={(e) => setForm({ ...form, mcVersions: e.target.value })} disabled={editing?.builtin} />
            </Field>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label mb-0">{t('templates.plugins')}</span>
              <button
                type="button"
                className="btn btn-xs btn-secondary"
                onClick={() => setForm({ ...form, refs: [...form.refs, { name: '', modrinthSlug: '', required: true }] })}
                disabled={editing?.builtin}
              >
                <Icon name="plus" size={11} /> {t('templates.addRef')}
              </button>
            </div>
            <div className="space-y-1.5">
              {form.refs.map((ref, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-1.5">
                  <input
                    className="input py-1 text-xs"
                    placeholder={t('templates.refName')}
                    value={ref.name}
                    onChange={(e) => setForm({ ...form, refs: form.refs.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)) })}
                    disabled={editing?.builtin}
                  />
                  <input
                    className="input py-1 text-xs"
                    placeholder={t('templates.refSlug')}
                    value={ref.modrinthSlug}
                    onChange={(e) => setForm({ ...form, refs: form.refs.map((item, i) => (i === index ? { ...item, modrinthSlug: e.target.value } : item)) })}
                    disabled={editing?.builtin}
                  />
                  <label className="flex items-center gap-1 text-[11px] text-slate-400">
                    <input
                      type="checkbox"
                      checked={ref.required}
                      onChange={(e) => setForm({ ...form, refs: form.refs.map((item, i) => (i === index ? { ...item, required: e.target.checked } : item)) })}
                      disabled={editing?.builtin}
                    />
                    {t('templates.refRequired')}
                  </label>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost text-slate-500 hover:text-red-300"
                    onClick={() => setForm({ ...form, refs: form.refs.filter((_, i) => i !== index) })}
                    disabled={editing?.builtin}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('templates.warning')} hint="One per line">
              <textarea className="textarea" rows={3} value={form.warnings} onChange={(e) => setForm({ ...form, warnings: e.target.value })} disabled={editing?.builtin} />
            </Field>
            <Field label={t('templates.installNotes')}>
              <textarea className="textarea" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={editing?.builtin} />
            </Field>
          </div>
          {formError ? <WarningList warnings={[formError]} tone="error" /> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('templates.delete')}
        message={t('templates.deleteConfirm', { name: deleteTarget?.name ?? '' })}
        danger
        busy={busy}
        confirmLabel={t('common.delete')}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </div>
  );
}
