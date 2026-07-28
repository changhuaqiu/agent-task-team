import type { A2AProjectionSnapshot } from '@/shared/project-view-events';
import { A2AReadModelProjection } from '../a2a/projection';
import type { PlatformEventHandler } from './dispatcher';

export interface A2AProjectViewProjectionOptions {
  projection?: Pick<A2AReadModelProjection, 'build'>;
  onProjected?: (snapshot: A2AProjectionSnapshot) => void;
}

export class A2AProjectViewProjection {
  private readonly projection: Pick<A2AReadModelProjection, 'build'>;

  constructor(private readonly options: A2AProjectViewProjectionOptions = {}) {
    this.projection = options.projection ?? new A2AReadModelProjection();
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (!event.type.startsWith('a2a.')) return;
    if (signal.aborted) throw signal.reason ?? new Error('a2a_projection_aborted');
    const snapshot = this.projection.build(event.projectId);
    if (!snapshot || !this.options.onProjected) return;
    try {
      this.options.onProjected(snapshot);
    } catch (error) {
      console.warn('[a2a-project-view-projection] notification failed:', error);
    }
  };
}
