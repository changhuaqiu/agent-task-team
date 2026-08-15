'use client';

import { useTaskHubStore } from '@/store/taskHubStore';
import type { RoleCard } from '@/types/roleCard';
import { RoleCardBadge, getCategoryConfig } from './RoleCardBadge';
import { Plus, Copy, Pencil, Trash2, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

function RoleCardCard({
  card,
  onDetail,
  onEdit,
  onClone,
  onDelete,
}: {
  card: RoleCard;
  onDetail: (id: string) => void;
  onEdit: (id: string) => void;
  onClone: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const cfg = getCategoryConfig(card.category);

  return (
    <div
      className={cn(
        'p-4 border-2 rounded-[4px] transition-all hover:-translate-y-1',
        `border-[hsl(var(${cfg.themeVar}))] bg-[hsl(var(${cfg.themeVar}-soft))]`,
        `shadow-[3px_3px_0px_hsl(var(${cfg.themeVar}))]`,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1.5 flex-1 min-w-0">
          <RoleCardBadge card={card} size="md" />
          <p className="text-[11px] text-[hsl(var(--text-secondary))] line-clamp-2">{card.description}</p>
        </div>
        {card.isPreset && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-[2px] border-2 border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-app))] shadow-[1px_1px_0px_hsl(var(--text-primary))] font-bold tracking-wider uppercase shrink-0 ml-2">
            预置
          </span>
        )}
      </div>

      {card.responsibilities.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {card.responsibilities.slice(0, 3).map((r) => (
            <span
              key={r}
              className={cn(
                'text-[9px] px-1.5 py-0.5 rounded-[2px] border',
                `border-[hsl(var(${cfg.themeVar}))] bg-[hsl(var(--bg-app))] text-[hsl(var(${cfg.themeVar}))]`,
              )}
            >
              {r}
            </span>
          ))}
          {card.responsibilities.length > 3 && (
            <span className="text-[9px] px-1 py-0.5 text-[hsl(var(--text-tertiary))]">+{card.responsibilities.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 mt-3 pt-3 border-t-2 border-[hsl(var(--text-primary)/0.1)]">
        <button
          onClick={() => onDetail(card.id)}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-app))] rounded-[2px] transition-colors"
        >
          <Eye className="w-3 h-3" /> 查看
        </button>
        <button
          onClick={() => onClone(card.id)}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-app))] rounded-[2px] transition-colors"
        >
          <Copy className="w-3 h-3" /> 克隆
        </button>
        {!card.isPreset && (
          <>
            <button
              onClick={() => onEdit(card.id)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-[2px] transition-colors',
                `text-[hsl(var(${cfg.themeVar}))] hover:bg-[hsl(var(--bg-app))]`,
              )}
            >
              <Pencil className="w-3 h-3" /> 编辑
            </button>
            <button
              onClick={() => onDelete(card.id)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-[hsl(var(--status-rejected))] hover:bg-[hsl(var(--status-rejected-bg))] rounded-[2px] transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function RoleCardListPage() {
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const setDetailOpen = useTaskHubStore((s) => s.setRoleCardDetailOpen);
  const setEditorOpen = useTaskHubStore((s) => s.setRoleCardEditorOpen);
  const removeRoleCard = useTaskHubStore((s) => s.removeRoleCard);
  const upsertRoleCard = useTaskHubStore((s) => s.upsertRoleCard);

  const presetCards = roleCards.filter((c) => c.isPreset);
  const customCards = roleCards.filter((c) => !c.isPreset);

  const handleDetail = (id: string) => setDetailOpen(true, id);
  const handleEdit = (id: string) => setEditorOpen(true, id);
  const handleDelete = (id: string) => removeRoleCard(id);
  const handleClone = (id: string) => {
    const card = roleCards.find((c) => c.id === id);
    if (!card) return;
    const { id: _, isPreset, version, createdAt, updatedAt, ...rest } = card;
    const newId = upsertRoleCard({ ...rest, name: `${card.name}-copy`, displayName: `${card.displayName} (副本)` });
    setEditorOpen(true, newId);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-bold text-[hsl(var(--text-primary))]">角色素材</h3>
          <p className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))] mt-0.5">
            作为团队成员身份模板复用，项目运行优先使用团队套件内的成员定义
          </p>
        </div>
        <button
          onClick={() => setEditorOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold bg-[hsl(var(--accent))] text-white border-2 border-[hsl(var(--accent))] shadow-[2px_2px_0px_hsl(var(--accent)/0.4)] rounded-[4px] hover:shadow-[1px_1px_0px_hsl(var(--accent)/0.4)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> 创建素材
        </button>
      </div>

      <div className="space-y-3">
        <h4 className="text-[10px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">预置素材</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {presetCards.map((card) => (
            <RoleCardCard key={card.id} card={card} onDetail={handleDetail} onEdit={handleEdit} onClone={handleClone} onDelete={handleDelete} />
          ))}
        </div>
      </div>

      {customCards.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-[10px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">自定义</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {customCards.map((card) => (
              <RoleCardCard key={card.id} card={card} onDetail={handleDetail} onEdit={handleEdit} onClone={handleClone} onDelete={handleDelete} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
