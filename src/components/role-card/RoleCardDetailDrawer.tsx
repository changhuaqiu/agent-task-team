'use client';

import { useState } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { getCategoryConfig } from './RoleCardBadge';
import { X, Copy, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tab = 'duty' | 'style' | 'rules';

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'accent' | 'warn' | 'muted' }) {
  return (
    <span
      className={cn(
        'text-[10px] px-1.5 py-0.5 rounded-[2px] border font-medium',
        tone === 'accent' && 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]',
        tone === 'warn' && 'border-[hsl(var(--status-rejected))] bg-[hsl(var(--status-rejected-bg))] text-[hsl(var(--status-rejected))]',
        tone === 'muted' && 'border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))]',
      )}
    >
      {children}
    </span>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="text-[12px] text-[hsl(var(--text-secondary))] flex items-start gap-1.5">
      <span className="text-[hsl(var(--text-tertiary))] mt-0.5">·</span> {children}
    </li>
  );
}

export function RoleCardDetailDrawer() {
  const [tab, setTab] = useState<Tab>('duty');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isOpen = useTaskHubStore((s) => s.isRoleCardDetailOpen);
  const selectedCardId = useTaskHubStore((s) => s.selectedRoleCardId);
  const setOpen = useTaskHubStore((s) => s.setRoleCardDetailOpen);
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const setRoleCardEditorOpen = useTaskHubStore((s) => s.setRoleCardEditorOpen);
  const removeRoleCard = useTaskHubStore((s) => s.removeRoleCard);
  const upsertRoleCard = useTaskHubStore((s) => s.upsertRoleCard);

  if (!isOpen || !selectedCardId) return null;

  const card = roleCards.find((c) => c.id === selectedCardId);
  if (!card) return null;

  const cfg = getCategoryConfig(card.category);

  const handleClone = () => {
    const { id, isPreset, version, createdAt, updatedAt, ...rest } = card;
    const newId = upsertRoleCard({ ...rest, name: `${card.name}-copy`, displayName: `${card.displayName} (副本)` });
    setOpen(false);
    setRoleCardEditorOpen(true, newId);
  };

  const handleEdit = () => {
    setOpen(false);
    setRoleCardEditorOpen(true, card.id);
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    removeRoleCard(card.id);
    setOpen(false);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'duty', label: '职责' },
    { key: 'style', label: '工作方式' },
    { key: 'rules', label: '边界' },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40"
        onClick={() => { setOpen(false); setConfirmDelete(false); }}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[400px] bg-[hsl(var(--bg-elevated))] border-l-2 border-[hsl(var(--text-primary))] shadow-[-4px_0_0px_hsl(var(--text-primary))] flex flex-col animate-slide-in-r">
        {/* Hero */}
        <div className={cn('px-5 py-5 border-b-2 border-[hsl(var(--text-primary))]', `bg-[hsl(var(${cfg.themeVar}-soft))]`)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-10 h-10 rounded-[4px] border-2 border-[hsl(var(--text-primary))] shadow-[2px_2px_0px_hsl(var(--text-primary))]',
                'flex items-center justify-center text-lg',
                `bg-[hsl(var(${cfg.themeVar}))]`,
              )}>
                {cfg.emoji}
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-[hsl(var(--text-primary))]">{card.displayName}</h2>
                <p className="text-[11px] text-[hsl(var(--text-secondary))]">{card.description}</p>
              </div>
            </div>
            <button
              onClick={() => { setOpen(false); setConfirmDelete(false); }}
              className="p-1.5 rounded-[4px] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] border-2 border-transparent hover:border-[hsl(var(--text-primary))] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {card.isPreset && (
            <span className="mt-2 inline-block text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-[2px] border-2 border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-app))] shadow-[1px_1px_0px_hsl(var(--text-primary))]">
              预置角色
            </span>
          )}
        </div>

        {/* Tab Bar */}
        <div className="flex border-b-2 border-[hsl(var(--text-primary))]">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex-1 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors border-b-2 -mb-[2px]',
                tab === t.key
                  ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]'
                  : 'border-transparent text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-secondary))]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin">
          {tab === 'duty' && (
            <>
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">职责</h4>
                <div className="flex flex-wrap gap-1">
                  {card.responsibilities.map((r) => <Chip key={r} tone="accent">{r}</Chip>)}
                </div>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">不负责</h4>
                <div className="flex flex-wrap gap-1">
                  {card.nonResponsibilities.length ? card.nonResponsibilities.map((r) => <Chip key={r} tone="warn">{r}</Chip>) : <span className="text-[11px] italic text-[hsl(var(--text-tertiary))]">无</span>}
                </div>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">成功标准</h4>
                <ul className="space-y-1">
                  {card.successCriteria.map((c) => <Bullet key={c}>{c}</Bullet>)}
                </ul>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">适合场景</h4>
                <div className="flex flex-wrap gap-1">
                  {card.applicableScenarios.map((s) => <Chip key={s}>{s}</Chip>)}
                </div>
              </div>
            </>
          )}

          {tab === 'style' && (
            <>
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">澄清策略</h4>
                <div className="px-3 py-2 rounded-[4px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))]">
                  <span className="text-[12px] font-medium text-[hsl(var(--text-primary))]">
                    {card.clarifyBeforeExecute === 'always' ? '先澄清再动手' : card.clarifyBeforeExecute === 'never' ? '直接行动' : '模糊时才澄清'}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">输出风格</h4>
                <div className="px-3 py-2 rounded-[4px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))]">
                  <span className="text-[12px] font-medium text-[hsl(var(--text-primary))]">
                    {card.outputStyle === 'concise' ? '简洁' : card.outputStyle === 'detailed' ? '详细' : '结构化'}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">输出格式</h4>
                <div className="px-3 py-2 rounded-[4px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))]">
                  <span className="text-[12px] font-medium text-[hsl(var(--text-primary))]">
                    {card.outputFormat === 'freeform' ? '自由格式' : card.outputFormat === 'structured_list' ? '列表' : card.outputFormat === 'report' ? '报告' : '检查单'}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">需要证据</h4>
                <div className="px-3 py-2 rounded-[4px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))]">
                  <span className="text-[12px] font-medium text-[hsl(var(--text-primary))]">{card.requiresEvidence ? '是 — 必须附带代码引用或截图' : '否'}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">风险分级</h4>
                <div className="px-3 py-2 rounded-[4px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))]">
                  <span className="text-[12px] font-medium text-[hsl(var(--text-primary))]">{card.riskGrading === 'required' ? '必须' : card.riskGrading === 'optional' ? '可选' : '不需要'}</span>
                </div>
              </div>
            </>
          )}

          {tab === 'rules' && (
            <>
              {card.forbiddenActions.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">禁止操作</h4>
                  <div className="flex flex-wrap gap-1">
                    {card.forbiddenActions.map((a) => <Chip key={a} tone="warn">{a}</Chip>)}
                  </div>
                </div>
              )}
              {card.requiresConfirmation.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))]">需用户确认</h4>
                  <ul className="space-y-1">
                    {card.requiresConfirmation.map((c) => <Bullet key={c}>{c}</Bullet>)}
                  </ul>
                </div>
              )}
              {card.forbiddenActions.length === 0 && card.requiresConfirmation.length === 0 && (
                <div className="text-center py-8 text-[hsl(var(--text-tertiary))]">
                  <span className="text-[12px] font-bold uppercase tracking-widest">无特殊限制</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t-2 border-[hsl(var(--text-primary))]">
          <button
            onClick={handleClone}
            className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold bg-[hsl(var(--bg-muted))] border-2 border-[hsl(var(--text-primary))] shadow-[2px_2px_0px_hsl(var(--text-primary))] rounded-[4px] hover:shadow-[1px_1px_0px_hsl(var(--text-primary))] hover:translate-x-[1px] hover:translate-y-[1px] transition-all"
          >
            <Copy className="w-3.5 h-3.5" /> 克隆
          </button>
          {!card.isPreset && (
            <>
              <button
                onClick={handleEdit}
                className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold bg-[hsl(var(--accent-soft))] border-2 border-[hsl(var(--accent))] shadow-[2px_2px_0px_hsl(var(--accent))] rounded-[4px] text-[hsl(var(--accent))] hover:shadow-[1px_1px_0px_hsl(var(--accent))] hover:translate-x-[1px] hover:translate-y-[1px] transition-all"
              >
                <Pencil className="w-3.5 h-3.5" /> 编辑
              </button>
              <button
                onClick={handleDelete}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold border-2 rounded-[4px] transition-all',
                  confirmDelete
                    ? 'bg-[hsl(var(--status-rejected))] text-white border-[hsl(var(--status-rejected))] shadow-[2px_2px_0px_hsl(var(--status-rejected))]'
                    : 'border-transparent text-[hsl(var(--status-rejected))] hover:bg-[hsl(var(--status-rejected-bg))]',
                )}
              >
                <Trash2 className="w-3.5 h-3.5" /> {confirmDelete ? '确认删除' : '删除'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
