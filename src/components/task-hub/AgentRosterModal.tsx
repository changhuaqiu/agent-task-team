'use client';

import { useTaskHubStore } from '@/store/taskHubStore';
import { useShallow } from 'zustand/react/shallow';
import { PixelAvatar } from './PixelAvatar';
import { X, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RoleCardSummary } from '@/components/role-card/RoleCardSummary';
import type { AgentTheme } from '@/store/agentStore';

const CARD_THEME_CLASSES: Record<AgentTheme, {
  border: string;
  hoverShadow: string;
  avatar: string;
  button: string;
}> = {
  mario: {
    border: 'border-[hsl(var(--agent-mario-border))]',
    hoverShadow: 'hover:shadow-[4px_4px_0px_hsl(var(--agent-mario))]',
    avatar: 'bg-[hsl(var(--agent-mario))] border-[hsl(var(--agent-mario-border))]',
    button: 'bg-[hsl(var(--agent-mario-soft))] text-[hsl(var(--agent-mario))] border-[hsl(var(--agent-mario-border))] hover:bg-[hsl(var(--agent-mario))] hover:text-[hsl(var(--bg-app))]',
  },
  luigi: {
    border: 'border-[hsl(var(--agent-luigi-border))]',
    hoverShadow: 'hover:shadow-[4px_4px_0px_hsl(var(--agent-luigi))]',
    avatar: 'bg-[hsl(var(--agent-luigi))] border-[hsl(var(--agent-luigi-border))]',
    button: 'bg-[hsl(var(--agent-luigi-soft))] text-[hsl(var(--agent-luigi))] border-[hsl(var(--agent-luigi-border))] hover:bg-[hsl(var(--agent-luigi))] hover:text-[hsl(var(--bg-app))]',
  },
  peach: {
    border: 'border-[hsl(var(--agent-peach-border))]',
    hoverShadow: 'hover:shadow-[4px_4px_0px_hsl(var(--agent-peach))]',
    avatar: 'bg-[hsl(var(--agent-peach))] border-[hsl(var(--agent-peach-border))]',
    button: 'bg-[hsl(var(--agent-peach-soft))] text-[hsl(var(--agent-peach))] border-[hsl(var(--agent-peach-border))] hover:bg-[hsl(var(--agent-peach))] hover:text-[hsl(var(--bg-app))]',
  },
  dk: {
    border: 'border-[hsl(var(--agent-dk-border))]',
    hoverShadow: 'hover:shadow-[4px_4px_0px_hsl(var(--agent-dk))]',
    avatar: 'bg-[hsl(var(--agent-dk))] border-[hsl(var(--agent-dk-border))]',
    button: 'bg-[hsl(var(--agent-dk-soft))] text-[hsl(var(--agent-dk))] border-[hsl(var(--agent-dk-border))] hover:bg-[hsl(var(--agent-dk))] hover:text-[hsl(var(--bg-app))]',
  },
};

export function AgentRosterModal() {
  const isOpen = useTaskHubStore((s) => s.isRosterModalOpen);
  const setOpen = useTaskHubStore((s) => s.setRosterModalOpen);
  const availableAgents = useTaskHubStore(useShallow((state) => (
    state.getEffectiveRoster().filter((agent) => !state.activeAgentIds.includes(agent.id))
  )));
  const inviteAgent = useTaskHubStore((s) => s.inviteAgent);
  const addChatMessage = useTaskHubStore((s) => s.addChatMessage);
  const getAgentRoleCard = useTaskHubStore((s) => s.getAgentRoleCard);

  if (!isOpen) return null;

  const handleRecruit = (agentId: string) => {
    inviteAgent(agentId);
    addChatMessage({
      agentId,
      content: `你好！我已加入团队，随时可以开始任务。`,
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
              智能体招募 / 名单
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
        <div className="p-6 min-h-0 overflow-y-auto flex-1 bg-[url('/noise.png')]">
          {availableAgents.length === 0 ? (
            <div className="text-center py-12 text-[hsl(var(--text-tertiary))] font-bold uppercase tracking-widest">
              所有可用智能体已招募完成！
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availableAgents.map((agent) => (
                (() => {
                  const theme = CARD_THEME_CLASSES[agent.theme];
                  const roleCard = getAgentRoleCard(agent.id);
                  return (
                <div
                  key={agent.id}
                  className={cn(
                    'group relative flex gap-4 p-4 rounded-[4px] border-2 bg-[hsl(var(--bg-card))] transition-transform hover:-translate-y-1',
                    theme.border,
                    theme.hoverShadow
                  )}
                >
                  {/* Avatar Side */}
                  <div
                    className={cn(
                      'shrink-0 w-16 h-16 rounded-[4px] border-2 flex items-center justify-center overflow-hidden',
                      theme.avatar
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
                      {roleCard && (
                        <div className="mt-1">
                          <RoleCardSummary card={roleCard} />
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => handleRecruit(agent.id)}
                      className={cn(
                        'mt-3 w-full py-1.5 px-3 rounded-[2px] text-[11px] font-bold uppercase tracking-widest border-2 transition-colors',
                        theme.button
                      )}
                    >
                      招募
                    </button>
                  </div>
                </div>
                  );
                })()
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
