'use client';

import { useTaskHubStore } from '@/store/taskHubStore';
import { useMemo, useState } from 'react';

export function ConversationPicker() {
  const conversations = useTaskHubStore((s) => s.conversations);
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const setSelectedConversationId = useTaskHubStore((s) => s.setSelectedConversationId);
  const createConversation = useTaskHubStore((s) => s.createConversation);

  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId),
    [conversations, selectedConversationId]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <select
          value={selectedConversationId}
          onChange={(e) => setSelectedConversationId(e.target.value)}
          className="h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] text-[12px] font-semibold"
        >
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <div className="text-[11px] text-[hsl(var(--text-tertiary))] font-semibold truncate">
          {selected?.goal}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Conversation title"
          className="h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] text-[12px] font-semibold"
        />
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Goal"
          className="h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] text-[12px] font-semibold md:col-span-2"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            const t = title.trim();
            const g = goal.trim();
            if (!t || !g) return;
            createConversation({ title: t, goal: g });
            setTitle('');
            setGoal('');
          }}
          className="h-9 px-3 rounded-[var(--radius-md)] bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] text-[12px] font-semibold hover:opacity-90 disabled:opacity-50"
          disabled={!title.trim() || !goal.trim()}
        >
          New Conversation
        </button>
      </div>
    </div>
  );
}

