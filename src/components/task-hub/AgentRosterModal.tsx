'use client';

import { useTaskHubStore, selectAvailableRoster } from '@/store/taskHubStore';
import { useShallow } from 'zustand/react/shallow';
import { PixelAvatar } from './PixelAvatar';
import { X, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AgentRosterModal() {
  const isOpen = useTaskHubStore((s) => s.isRosterModalOpen);
  const setOpen = useTaskHubStore((s) => s.setRosterModalOpen);
  const availableAgents = useTaskHubStore(useShallow(selectAvailableRoster));
  const inviteAgent = useTaskHubStore((s) => s.inviteAgent);
  const addChatMessage = useTaskHubStore((s) => s.addChatMessage);

  if (!isOpen) return null;

  const handleRecruit = (agentId: string, agentName: string) => {
    inviteAgent(agentId);
    addChatMessage({
      agentId,
      content: `Hello Traveler! I've joined the party. Ready to take on some tasks.`,
      intent: 'general',
    });
    // Close modal if no more agents left
    if (availableAgents.length <= 1) {
      setOpen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[hsl(var(--bg-app))] w-full max-w-3xl rounded-[4px] shadow-[4px_4px_0px_#000] border-2 border-[hsl(var(--text-primary))] flex flex-col max-h-[85vh] animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b-2 border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-card))]">
          <div className="flex items-center gap-2 text-[hsl(var(--accent))]">
            <Sparkles className="w-5 h-5" />
            <h2 className="text-[16px] font-bold uppercase tracking-wide">
              Agent Wish / Roster
            </h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--status-rejected))] hover:bg-[hsl(var(--status-rejected-bg))] rounded-[4px] transition-colors border-2 border-transparent hover:border-[hsl(var(--status-rejected))]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-[url('/noise.png')]">
          {availableAgents.length === 0 ? (
            <div className="text-center py-12 text-[hsl(var(--text-tertiary))] font-bold uppercase tracking-widest">
              All available agents have been recruited!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availableAgents.map((agent) => (
                <div
                  key={agent.id}
                  className={cn(
                    'group relative flex gap-4 p-4 rounded-[4px] border-2 bg-[hsl(var(--bg-card))] transition-transform hover:-translate-y-1',
                    `border-[hsl(var(--agent-${agent.theme}-border))]`,
                    `hover:shadow-[4px_4px_0px_hsl(var(--agent-${agent.theme}))]`
                  )}
                >
                  {/* Avatar Side */}
                  <div
                    className={cn(
                      'shrink-0 w-16 h-16 rounded-[4px] border-2 flex items-center justify-center overflow-hidden',
                      `bg-[hsl(var(--agent-${agent.theme}))] border-[hsl(var(--agent-${agent.theme}-border))]`
                    )}
                  >
                    <PixelAvatar theme={agent.theme} size={64} />
                  </div>

                  {/* Info Side */}
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="text-[14px] font-bold text-[hsl(var(--text-primary))] flex items-center gap-2">
                        {agent.name} <span>{agent.emoji}</span>
                      </h3>
                      <p className="text-[10px] font-bold text-[hsl(var(--text-tertiary))] uppercase tracking-wider mt-0.5">
                        {agent.roleLabel}
                      </p>
                    </div>

                    <button
                      onClick={() => handleRecruit(agent.id, agent.name)}
                      className={cn(
                        'mt-3 w-full py-1.5 px-3 rounded-[2px] text-[11px] font-bold uppercase tracking-widest border-2 transition-colors',
                        `bg-[hsl(var(--agent-${agent.theme}-soft))]`,
                        `text-[hsl(var(--agent-${agent.theme}))]`,
                        `border-[hsl(var(--agent-${agent.theme}-border))]`,
                        `hover:bg-[hsl(var(--agent-${agent.theme}))] hover:text-[hsl(var(--bg-app))]`
                      )}
                    >
                      Recruit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
