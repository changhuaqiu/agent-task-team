'use client';

import { useState, useRef, useEffect } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { ChatMessageItem } from './ChatMessageItem';
import { Send, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';

export function GlobalChatRoom() {
  const chatMessages = useTaskHubStore((s) => s.chatMessages);
  const addChatMessage = useTaskHubStore((s) => s.addChatMessage);
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSend = () => {
    if (!inputValue.trim()) return;

    // Basic regex to detect `#TASK-XXX` references
    const taskRefMatch = inputValue.match(/#TASK-\d{3}/i);

    addChatMessage({
      agentId: 'human',
      content: inputValue,
      referencedTaskId: taskRefMatch ? taskRefMatch[0].toUpperCase() : undefined,
    });

    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--bg-app))] border-l-[2px] border-[hsl(var(--border))] shadow-[-4px_0_12px_rgba(0,0,0,0.05)] w-full">
      {/* Header */}
      <div className="shrink-0 h-[60px] flex items-center justify-between px-5 bg-[hsl(var(--bg-card))] border-b-[2px] border-[hsl(var(--border))]">
        <h2 className="text-[14px] font-bold text-[hsl(var(--text-primary))] flex items-center gap-2">
          <Hash className="w-4 h-4 text-[hsl(var(--accent))]" />
          Global Chat Room
        </h2>
        <span className="text-[10px] font-bold text-[hsl(var(--text-tertiary))] bg-[hsl(var(--bg-muted))] px-2 py-1 rounded-[4px] border border-[hsl(var(--border-subtle))]">
          {chatMessages.length} Messages
        </span>
      </div>

      {/* Message List */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-5 flex flex-col gap-6 scrollbar-thin scroll-smooth"
        style={{ backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 0)', backgroundSize: '16px 16px' }}
      >
        {chatMessages.map((msg) => (
          <ChatMessageItem key={msg.id} message={msg} />
        ))}
      </div>

      {/* Input Area */}
      <div className="shrink-0 p-4 bg-[hsl(var(--bg-card))] border-t-[2px] border-[hsl(var(--border))] shadow-[0_-4px_12px_rgba(0,0,0,0.02)]">
        <div className="relative flex items-end gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message or @agent..."
            rows={1}
            className={cn(
              'w-full bg-[hsl(var(--bg-app))] text-[hsl(var(--text-primary))] text-[13px] placeholder:text-[hsl(var(--text-tertiary))]',
              'rounded-[4px] border-[2px] border-[hsl(var(--border))] px-3 py-2.5',
              'focus:outline-none focus:border-[hsl(var(--accent))] focus:ring-0',
              'resize-none scrollbar-thin overflow-y-auto min-h-[44px] max-h-[120px]'
            )}
            style={{
              // Auto-grow hack approximation
              height: inputValue ? `${Math.min(120, Math.max(44, inputValue.split('\n').length * 20 + 24))}px` : '44px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className={cn(
              'shrink-0 flex items-center justify-center w-11 h-11 rounded-[4px] transition-all',
              'bg-[hsl(var(--accent))] text-[hsl(var(--bg-app))]',
              'border-[2px] border-[hsl(var(--accent-border, var(--accent)))]',
              'shadow-[2px_2px_0px_hsl(var(--text-primary))]',
              'hover:brightness-110 active:translate-y-[2px] active:translate-x-[2px] active:shadow-none',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-[2px] disabled:translate-x-[2px]'
            )}
          >
            <Send className="w-5 h-5 ml-1" />
          </button>
        </div>
        <p className="text-[9px] font-medium text-[hsl(var(--text-tertiary))] mt-2 ml-1">
          Use #TASK-000 to reference tasks.
        </p>
      </div>
    </div>
  );
}
