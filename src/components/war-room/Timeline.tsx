'use client';

import { useTaskHubStore } from '@/store/taskHubStore';
import { useMemo } from 'react';
import { EventCard } from './TimelineCards';

export function Timeline() {
  const events = useTaskHubStore((s) => s.getEventsForSelectedConversation());

  const { stickyStatus, rest } = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type !== 'supervisor.output') continue;
      const payload = e.payload as { kind?: string } | undefined;
      if (payload?.kind === 'status_report') {
        return { stickyStatus: e, rest: events.filter((x) => x.id !== e.id) };
      }
    }
    return { stickyStatus: undefined, rest: events };
  }, [events]);

  const sorted = useMemo(() => {
    return [...rest].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [rest]);

  const items = useMemo(() => {
    return stickyStatus ? [stickyStatus, ...sorted] : sorted;
  }, [sorted, stickyStatus]);

  return (
    <div className="flex flex-col gap-3">
      {items.map((e) => (
        <EventCard key={e.id} event={e} />
      ))}
    </div>
  );
}
