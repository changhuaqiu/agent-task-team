'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';

interface ChatApprovalActionsProps {
  messageId: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  artifactPreview?: {
    files: Array<{
      path: string;
      change: 'added' | 'modified' | 'deleted';
    }>;
  };
  onUpdateStatus: (msgId: string, status: 'approved' | 'rejected', rejectionReason?: string) => void;
}

export function ChatApprovalActions({
  messageId,
  approvalStatus,
  rejectionReason,
  artifactPreview,
  onUpdateStatus,
}: ChatApprovalActionsProps) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  return (
    <div className="mt-3 pt-2 border-t border-dashed border-[hsl(var(--border-subtle))] flex flex-col gap-2">
      {artifactPreview && artifactPreview.files.length > 0 && (
        <div className="mb-2 p-2 bg-[hsl(var(--bg-app))] rounded-[4px] border border-[hsl(var(--border-subtle))]">
          <div className="text-[9px] text-[hsl(var(--text-tertiary))] mb-1">产出物预览：</div>
          <div className="font-mono text-[10px] space-y-0.5">
            {artifactPreview.files.map((file, fi) => (
              <div key={fi} className={cn(
                file.change === 'added' && 'text-emerald-400',
                file.change === 'modified' && 'text-blue-400',
                file.change === 'deleted' && 'text-red-400',
              )}>
                {file.change === 'added' && '+ '}
                {file.change === 'modified' && '~ '}
                {file.change === 'deleted' && '- '}
                <span className="text-[hsl(var(--accent))]">{file.path}</span>
                <span className="text-[hsl(var(--text-tertiary))]"> ({file.change === 'added' ? '新增' : file.change === 'modified' ? '修改' : '删除'})</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {approvalStatus === 'pending' ? (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onUpdateStatus(messageId, 'approved');
                setShowRejectInput(false);
              }}
              className="flex-1 flex items-center justify-center gap-1 bg-[hsl(var(--status-done))] hover:brightness-110 text-[hsl(var(--bg-app))] text-[10px] font-bold py-1.5 px-2 rounded-[2px] shadow-[2px_2px_0px_hsl(var(--text-primary))] transition-transform active:translate-y-[2px] active:shadow-[0px_0px_0px_hsl(var(--text-primary))]"
            >
              <Check className="w-3 h-3" /> 同意
            </button>
            <button
              onClick={() => setShowRejectInput(true)}
              className="flex-1 flex items-center justify-center gap-1 bg-[hsl(var(--status-rejected))] hover:brightness-110 text-[hsl(var(--bg-app))] text-[10px] font-bold py-1.5 px-2 rounded-[2px] shadow-[2px_2px_0px_hsl(var(--text-primary))] transition-transform active:translate-y-[2px] active:shadow-[0px_0px_0px_hsl(var(--text-primary))]"
            >
              <X className="w-3 h-3" /> 拒绝
            </button>
          </div>
          {showRejectInput && (
            <div className="mt-2 p-2 bg-[hsl(var(--bg-app))] border border-[hsl(var(--status-rejected-border))] rounded-[4px]">
              <div className="text-[9px] font-bold text-[hsl(var(--status-rejected))] mb-1">拒绝原因：</div>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="描述问题或建议修改…"
                rows={2}
                className="w-full bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-primary))] text-[11px] rounded-[2px] border border-[hsl(var(--border))] px-2 py-1.5 focus:outline-none focus:border-[hsl(var(--status-rejected))] resize-none"
              />
              <div className="flex justify-end mt-1">
                <button
                  onClick={() => {
                    if (!rejectReason.trim()) return;
                    onUpdateStatus(messageId, 'rejected', rejectReason.trim());
                    setShowRejectInput(false);
                    setRejectReason('');
                  }}
                  disabled={!rejectReason.trim()}
                  className="text-[9px] font-bold px-3 py-1 bg-[hsl(var(--status-rejected))] text-[hsl(var(--bg-app))] rounded-[2px] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  提交反馈
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div
          className={cn(
            'w-full text-center text-[10px] font-bold py-1 rounded-[2px] border',
            approvalStatus === 'approved'
              ? 'bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done))] border-[hsl(var(--status-done-border))]'
              : 'bg-[hsl(var(--status-rejected-bg))] text-[hsl(var(--status-rejected))] border-[hsl(var(--status-rejected-border))]'
          )}
        >
          {approvalStatus === 'approved' ? '已同意' : `已拒绝${rejectionReason ? '：' + rejectionReason.slice(0, 30) : ''}`}
        </div>
      )}
    </div>
  );
}
