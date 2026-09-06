'use client';

import { useEffect, useState } from 'react';

export function FocusedMessage({ messageId, conversationId, projectId }: { messageId: string; conversationId?: string; projectId?: string }) {
  const query = new URLSearchParams({ messageId, ...(conversationId ? { conversationId } : {}), ...(projectId ? { projectId } : {}) }).toString();
  const [state, setState] = useState<{ query: string; content?: string; author?: string; time?: string; error?: string }>();
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/messages?' + query, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error('原消息不存在或不属于当前工作范围。'); return response.json(); })
      .then(({ message }) => { if (!controller.signal.aborted) setState({ query, content: message.content, author: message.sender_id, time: message.created_at }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ query, error: error.message }); });
    return () => controller.abort();
  }, [query]);
  if (closed) return null;
  const current = state?.query === query ? state : undefined;
  return <section aria-label="通知对应消息" className="shrink-0 rounded-xl border border-[hsl(var(--accent))]/30 bg-[hsl(var(--accent-soft))] p-4">
    <header className="flex items-center justify-between"><h4 className="text-xs font-semibold">{current?.content !== undefined ? '已定位原消息' : '通知对应消息'}</h4><button type="button" onClick={() => setClosed(true)} aria-label="关闭定位消息" className="text-xs underline">收起</button></header>
    {!current ? <p role="status" className="mt-2 text-xs">正在读取…</p> : current.error ? <p role="alert" className="mt-2 text-xs">{current.error}</p> : <><p className="mt-2 text-xs text-[hsl(var(--text-tertiary))]">{current.author} · {current.time && new Date(current.time).toLocaleString('zh-CN')}</p><div className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">{current.content}</div></>}
  </section>;
}
