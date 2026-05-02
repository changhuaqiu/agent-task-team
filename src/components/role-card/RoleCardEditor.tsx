'use client';

import { useState, useEffect } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import type { RoleCardCategory, OutputStyle, ClarifyPolicy, OutputFormat, RiskGrading } from '@/types/roleCard';
import { getCategoryConfig } from './RoleCardBadge';
import { TagEditor } from '@/components/ui/TagEditor';
import { X, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const CATEGORIES: { value: RoleCardCategory; label: string }[] = [
  { value: 'planner', label: '规划师' },
  { value: 'frontend', label: '前端实现' },
  { value: 'backend', label: '后端实现' },
  { value: 'code_reviewer', label: '代码评审' },
  { value: 'arch_reviewer', label: '架构评审' },
  { value: 'qa', label: '质量守卫' },
];

const CHOICES = {
  outputStyle: [
    { value: 'concise', label: '简洁' },
    { value: 'detailed', label: '详细' },
    { value: 'structured', label: '结构化' },
  ],
  clarifyBeforeExecute: [
    { value: 'always', label: '总是' },
    { value: 'when_ambiguous', label: '模糊时' },
    { value: 'never', label: '从不' },
  ],
  outputFormat: [
    { value: 'freeform', label: '自由' },
    { value: 'structured_list', label: '列表' },
    { value: 'report', label: '报告' },
    { value: 'checklist', label: '检查单' },
  ],
  riskGrading: [
    { value: 'none', label: '无' },
    { value: 'optional', label: '可选' },
    { value: 'required', label: '必须' },
  ],
};

function ChoiceBar({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-2.5 py-1 text-[11px] font-bold rounded-[2px] border-2 transition-all',
            value === opt.value
              ? 'bg-[hsl(var(--accent))] text-white border-[hsl(var(--accent))] shadow-[2px_2px_0px_hsl(var(--accent)/0.4)]'
              : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))] border-[hsl(var(--border))] hover:border-[hsl(var(--text-primary))]',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Collapsible({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-2 border-[hsl(var(--border))] rounded-[4px] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-[hsl(var(--bg-muted))] hover:bg-[hsl(var(--bg-app))] transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-[hsl(var(--text-tertiary))]" /> : <ChevronRight className="w-3.5 h-3.5 text-[hsl(var(--text-tertiary))]" />}
        <span className="text-[11px] font-bold tracking-wider uppercase text-[hsl(var(--text-secondary))]">{title}</span>
      </button>
      {open && <div className="px-3 py-3 space-y-3">{children}</div>}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 text-[12px] bg-[hsl(var(--bg-muted))] border-2 border-[hsl(var(--border))] rounded-[4px] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))] outline-none focus:border-[hsl(var(--accent))] transition-all';

export function RoleCardEditor() {
  const isOpen = useTaskHubStore((s) => s.isRoleCardEditorOpen);
  const editingCardId = useTaskHubStore((s) => s.editingRoleCardId);
  const setOpen = useTaskHubStore((s) => s.setRoleCardEditorOpen);
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const upsertRoleCard = useTaskHubStore((s) => s.upsertRoleCard);

  const existing = editingCardId ? roleCards.find((c) => c.id === editingCardId) : null;

  const [form, setForm] = useState({
    name: '',
    displayName: '',
    description: '',
    category: 'planner' as RoleCardCategory,
    tags: [] as string[],
    applicableScenarios: [] as string[],
    responsibilities: [] as string[],
    nonResponsibilities: [] as string[],
    successCriteria: [] as string[],
    clarifyBeforeExecute: 'when_ambiguous' as ClarifyPolicy,
    outputStyle: 'concise' as OutputStyle,
    outputFormat: 'freeform' as OutputFormat,
    requiresEvidence: false,
    riskGrading: 'none' as RiskGrading,
    forbiddenActions: [] as string[],
    requiresConfirmation: [] as string[],
  });

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name,
        displayName: existing.displayName,
        description: existing.description,
        category: existing.category,
        tags: [...existing.tags],
        applicableScenarios: [...existing.applicableScenarios],
        responsibilities: [...existing.responsibilities],
        nonResponsibilities: [...existing.nonResponsibilities],
        successCriteria: [...existing.successCriteria],
        clarifyBeforeExecute: existing.clarifyBeforeExecute,
        outputStyle: existing.outputStyle,
        outputFormat: existing.outputFormat,
        requiresEvidence: existing.requiresEvidence,
        riskGrading: existing.riskGrading,
        forbiddenActions: [...existing.forbiddenActions],
        requiresConfirmation: [...existing.requiresConfirmation],
      });
    } else {
      setForm({
        name: '', displayName: '', description: '', category: 'planner',
        tags: [], applicableScenarios: [], responsibilities: [], nonResponsibilities: [],
        successCriteria: [], clarifyBeforeExecute: 'when_ambiguous', outputStyle: 'concise',
        outputFormat: 'freeform', requiresEvidence: false, riskGrading: 'none',
        forbiddenActions: [], requiresConfirmation: [],
      });
    }
  }, [existing, isOpen]);

  if (!isOpen) return null;

  const cfg = getCategoryConfig(form.category);
  const canSubmit = form.name.trim() && form.displayName.trim() && form.responsibilities.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    upsertRoleCard({
      ...(editingCardId ? { id: editingCardId } : {}),
      name: form.name.trim(),
      displayName: form.displayName.trim(),
      description: form.description.trim(),
      category: form.category,
      tags: form.tags,
      applicableScenarios: form.applicableScenarios,
      responsibilities: form.responsibilities,
      nonResponsibilities: form.nonResponsibilities,
      successCriteria: form.successCriteria,
      clarifyBeforeExecute: form.clarifyBeforeExecute,
      outputStyle: form.outputStyle,
      preferStructuredOutput: form.outputStyle === 'structured',
      allowedActions: [],
      requiresConfirmation: form.requiresConfirmation,
      forbiddenActions: form.forbiddenActions,
      preferredEngines: [],
      allowedTools: [],
      accountIds: [],
      outputFormat: form.outputFormat,
      requiresEvidence: form.requiresEvidence,
      riskGrading: form.riskGrading,
    });
    setOpen(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40" onClick={() => setOpen(false)} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-[520px] max-h-[85vh] bg-[hsl(var(--bg-elevated))] border-2 border-[hsl(var(--text-primary))] shadow-[4px_4px_0px_hsl(var(--text-primary))] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={cn('flex items-center justify-between px-5 py-4 border-b-2 border-[hsl(var(--text-primary))]', `bg-[hsl(var(${cfg.themeVar}-soft))]`)}>
            <div className="flex items-center gap-2">
              <span className="text-sm">{cfg.emoji}</span>
              <h2 className="text-[14px] font-bold text-[hsl(var(--text-primary))]">
                {existing ? '编辑角色卡' : '创建角色卡'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-[4px] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] border-2 border-transparent hover:border-[hsl(var(--text-primary))] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin">
            {/* Section 1: Identity (always open) */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">名称 *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="frontend-dev" className={inputCls} required />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">显示名 *</label>
                  <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="前端实现" className={inputCls} required />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">描述</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="一句话描述角色职责" rows={2} className={cn(inputCls, 'resize-none')} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">类别</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as RoleCardCategory })} className={inputCls}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            {/* Section 2: Responsibilities (always open) */}
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">职责</h4>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[hsl(var(--text-secondary))]">负责 *</label>
                <TagEditor tags={form.responsibilities} onChange={(responsibilities) => setForm({ ...form, responsibilities })} addLabel="+ 职责" placeholder="添加职责" emptyLabel="至少一项" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[hsl(var(--text-secondary))]">不负责</label>
                <TagEditor tags={form.nonResponsibilities} onChange={(nonResponsibilities) => setForm({ ...form, nonResponsibilities })} addLabel="+ 限制" placeholder="添加非职责" emptyLabel="暂无限制" tone="purple" />
              </div>
            </div>

            {/* Section 3: Advanced (collapsed by default) */}
            <Collapsible title="更多设置（工作方式 / 边界 / 质量）" defaultOpen={!!existing}>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[hsl(var(--text-secondary))]">澄清策略</label>
                <ChoiceBar value={form.clarifyBeforeExecute} options={CHOICES.clarifyBeforeExecute} onChange={(v) => setForm({ ...form, clarifyBeforeExecute: v as ClarifyPolicy })} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[hsl(var(--text-secondary))]">输出风格</label>
                <ChoiceBar value={form.outputStyle} options={CHOICES.outputStyle} onChange={(v) => setForm({ ...form, outputStyle: v as OutputStyle })} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[hsl(var(--text-secondary))]">输出格式</label>
                <ChoiceBar value={form.outputFormat} options={CHOICES.outputFormat} onChange={(v) => setForm({ ...form, outputFormat: v as OutputFormat })} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[hsl(var(--text-secondary))]">禁止操作</label>
                <TagEditor tags={form.forbiddenActions} onChange={(forbiddenActions) => setForm({ ...form, forbiddenActions })} addLabel="+ 禁止" placeholder="添加禁止项" emptyLabel="暂无禁止项" tone="purple" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[hsl(var(--text-secondary))]">需要证据</label>
                <ChoiceBar value={form.requiresEvidence ? 'yes' : 'no'} options={[{ value: 'yes', label: '是' }, { value: 'no', label: '否' }]} onChange={(v) => setForm({ ...form, requiresEvidence: v === 'yes' })} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[hsl(var(--text-secondary))]">风险分级</label>
                <ChoiceBar value={form.riskGrading} options={CHOICES.riskGrading} onChange={(v) => setForm({ ...form, riskGrading: v as RiskGrading })} />
              </div>
            </Collapsible>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-4 border-t-2 border-[hsl(var(--text-primary))]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2 text-[11px] font-bold bg-[hsl(var(--bg-muted))] border-2 border-[hsl(var(--text-primary))] shadow-[2px_2px_0px_hsl(var(--text-primary))] rounded-[4px] hover:shadow-[1px_1px_0px_hsl(var(--text-primary))] hover:translate-x-[1px] hover:translate-y-[1px] transition-all"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold rounded-[4px] transition-all',
                'bg-[hsl(var(--accent))] text-white border-2 border-[hsl(var(--accent))] shadow-[2px_2px_0px_hsl(var(--accent)/0.4)]',
                'hover:shadow-[1px_1px_0px_hsl(var(--accent)/0.4)] hover:translate-x-[1px] hover:translate-y-[1px]',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              {existing ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
