'use client';

import { useTaskHubStore } from '@/store/taskHubStore';
import { useMemo } from 'react';
import { EventCard } from './TimelineCards';

export function Timeline() {
  const events = useTaskHubStore((s) => s.getEventsForSelectedConversation());

  const sorted = useMemo(() => {
    return [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [events]);

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((e) => (
        <EventCard key={e.id} event={e} />
      ))}
    </div>
  );
}

