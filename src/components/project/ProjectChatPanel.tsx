'use client';

import { GlobalChatRoom } from '@/components/task-hub/GlobalChatRoom';
import { AutonomousDeliveryPanel } from './AutonomousDeliveryPanel';
import { DeliveryWorkspaceOverview } from './DeliveryWorkspaceOverview';
import { PackageOpen } from 'lucide-react';
import type { DeliveryRunSnapshot } from '@/server/autonomous-delivery/types';
import type { DeliveryWorkspaceView } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';
import { cn } from '@/lib/utils';

export function ProjectChatPanel({
  view = null,
  surface = 'overview',
  onDeliveryRunSnapshotChange,
}: {
  view?: DeliveryWorkspaceView | null;
  surface?: 'overview' | 'activity';
  onDeliveryRunSnapshotChange?: (snapshot: DeliveryRunSnapshot | undefined) => void;
}) {
  const selectedDeliveryId = view?.delivery.id;

  if (!view) {
    return (
      <section className="flex h-full min-w-0 flex-1 items-center justify-center bg-[hsl(var(--bg-app))] px-6" data-testid="delivery-empty-state">
        <div className="max-w-sm text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))]">
            <PackageOpen className="size-5" />
          </div>
          <h2 className="mt-4 text-base font-medium text-[hsl(var(--text-primary))]">从项目工作开始</h2>
          <p className="mt-2 text-sm leading-6 text-[hsl(var(--text-secondary))]">
            创建工作后，目标、验收、执行进度和团队活动会集中显示在这里。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-[hsl(var(--bg-app))]">
      <div className={cn('min-h-0 flex-1 overflow-y-auto', surface !== 'overview' && 'hidden')} data-testid="delivery-overview-surface">
        <DeliveryWorkspaceOverview view={view} />
        {selectedDeliveryId && (
          <div className="overflow-y-auto" data-testid="autonomous-delivery-viewport">
            <AutonomousDeliveryPanel
              key={selectedDeliveryId}
              conversationId={selectedDeliveryId}
              stage={view.stage}
              onSnapshotChange={onDeliveryRunSnapshotChange}
            />
          </div>
        )}
      </div>

      <div className={cn(
        'min-h-0 flex-1 flex-col',
        surface === 'activity' ? 'flex' : 'hidden',
      )} data-testid="delivery-activity-surface">
        <div className="shrink-0 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-5 py-3">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-sm font-semibold text-[hsl(var(--text-primary))]">团队活动</div>
              <div className="mt-0.5 text-[11px] text-[hsl(var(--text-tertiary))]">围绕当前交付的讨论、工作变化和交接记录</div>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1" data-testid="project-chat-viewport">
          <GlobalChatRoom variant="embedded" />
        </div>
      </div>
    </section>
  );
}
