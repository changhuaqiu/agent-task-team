'use client';

import { GlobalChatRoom } from '@/components/task-hub/GlobalChatRoom';
import { AgentBar } from '@/components/task-hub/AgentBar';
import { AutonomousDeliveryPanel } from './AutonomousDeliveryPanel';
import { DeliveryWorkspaceOverview } from './DeliveryWorkspaceOverview';
import type { DeliveryRunSnapshot } from '@/server/autonomous-delivery/types';
import type { DeliveryWorkspaceView } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';

export function ProjectChatPanel({
  view = null,
  onDeliveryRunSnapshotChange,
}: {
  view?: DeliveryWorkspaceView | null;
  onDeliveryRunSnapshotChange?: (snapshot: DeliveryRunSnapshot | undefined) => void;
}) {
  const selectedDeliveryId = view?.delivery.id;

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-[hsl(var(--bg-app))]">
      <DeliveryWorkspaceOverview view={view} />

      {selectedDeliveryId && (
        <div className="max-h-[32%] shrink-0 overflow-y-auto" data-testid="autonomous-delivery-viewport">
          <AutonomousDeliveryPanel
            key={selectedDeliveryId}
            conversationId={selectedDeliveryId}
            stage={view?.stage}
            onSnapshotChange={onDeliveryRunSnapshotChange}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col border-t border-[hsl(var(--border-subtle))]">
        <div className="shrink-0 bg-[hsl(var(--bg-card))] px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[hsl(var(--text-primary))]">团队活动</div>
              <div className="mt-0.5 text-[10px] text-[hsl(var(--text-tertiary))]">关键讨论、工作变化和交接记录</div>
            </div>
            <AgentBar />
          </div>
        </div>
        <div className="min-h-0 flex-1" data-testid="project-chat-viewport">
          <GlobalChatRoom variant="embedded" />
        </div>
      </div>
    </section>
  );
}
