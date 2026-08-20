'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import {
  AGENT_OBSERVABILITY_OPEN_EVENT,
  type AgentObservabilityTarget,
} from './agent-observability-controller';

const AgentObservabilityDrawer = dynamic(() => import('./AgentObservabilityDrawer').then((mod) => mod.AgentObservabilityDrawer));

export function AgentObservabilityDrawerHost() {
  const [target, setTarget] = useState<AgentObservabilityTarget>();

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<AgentObservabilityTarget>).detail;
      if (detail?.conversationId) setTarget(detail);
    };
    window.addEventListener(AGENT_OBSERVABILITY_OPEN_EVENT, open);
    return () => window.removeEventListener(AGENT_OBSERVABILITY_OPEN_EVENT, open);
  }, []);

  return target
    ? <AgentObservabilityDrawer
        key={JSON.stringify(target)}
        target={target}
        onClose={() => setTarget(undefined)}
      />
    : null;
}
