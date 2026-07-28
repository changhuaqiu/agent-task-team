'use client';

import { useTaskHubStore } from '@/store/taskHubStore';
import { EventCard } from './TimelineCards';

export function Timeline() {
  const events = useTaskHubStore((s) => s.getEventsForSelectedConversation());

  let stickyStatus: (typeof events)[number] | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== 'platform.notice') continue;
    const payload = event.payload as { kind?: string } | undefined;
    if (payload?.kind !== 'status_report') continue;
    stickyStatus = event;
    break;
  }
  const rest = stickyStatus
    ? events.filter((event) => event.id !== stickyStatus?.id)
    : events;
  const sorted = [...rest].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const items = stickyStatus ? [stickyStatus, ...sorted] : sorted;

  return (
    <div className="flex flex-col gap-3">
      {items.map((e) => (
        <EventCard key={e.id} event={e} />
      ))}
    </div>
  );
}
