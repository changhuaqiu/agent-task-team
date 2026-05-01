'use client';

import { useTaskHubStore } from '@/store/taskHubStore';
import { ConversationPicker } from './ConversationPicker';
import { Timeline } from './Timeline';

export function WarRoomView() {
  const selectedConversation = useTaskHubStore((s) => s.getSelectedConversation());
  const addSupervisorOutput = useTaskHubStore((s) => s.addSupervisorOutput);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        <ConversationPicker />

        <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                Supervisor Brief
              </div>
              <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))]">
                {selectedConversation?.title}
              </div>
              <div className="text-[12px] text-[hsl(var(--text-tertiary))] mt-1">
                {selectedConversation?.goal}
              </div>
            </div>

            <button
              type="button"
              className="h-9 px-3 rounded-[var(--radius-md)] bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] text-[12px] font-semibold"
              onClick={() => {
                if (!selectedConversation) return;
                const stamp = new Date().toISOString();
                addSupervisorOutput({
                  kind: 'execution_plan',
                  conversationId: selectedConversation.id,
                  invocationId: `inv-${Date.now()}`,
                  timestamp: stamp,
                  summary: 'Execution Plan v0 generated. Ready to start Batch 1.',
                  needsHuman: true,
                  humanActions: [
                    { actionId: 'confirm_plan', label: 'Confirm & Start Batch 1' },
                    { actionId: 'edit_plan', label: 'Edit Plan' },
                  ],
                  body: {
                    planVersion: 1,
                    qualityProfile: { requiredGates: ['lint', 'typecheck', 'unit', 'build'], policy: 'fail_block' },
                    batches: [{ batchId: 'batch_1', title: 'Bootstrap', tasks: ['dev', 'ux', 'qa', 'arch'] }],
                  },
                });
              }}
            >
              Generate Plan
            </button>
          </div>
        </div>

        <Timeline />
      </div>
    </div>
  );
}

