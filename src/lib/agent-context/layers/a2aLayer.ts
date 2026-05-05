// src/lib/agent-context/layers/a2aLayer.ts
// A2A v2: context is built by orchestrator and injected as the prompt itself.
// This layer only handles the a2a metadata marker for the compose pipeline.

export interface A2ALayerOpts {
  a2aFrom?: string;
  a2aContent?: string;
  a2aContextSnapshot?: string;
}

export function buildA2ALayer(opts: A2ALayerOpts): string {
  if (!opts.a2aFrom || !opts.a2aContent) return '';

  // In v2, the orchestrator already built the full dispatch prompt
  // with chain context, cursor-based incremental messages, task summary,
  // and response guidance. We pass it through as-is.
  return opts.a2aContent;
}
