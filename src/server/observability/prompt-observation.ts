import { spanPayloadRepo } from '../repositories/span-payload-repo';

export interface CapturePromptObservationInput {
  spanId: string;
  assembledPrompt: string;
  systemPrompt?: string;
  onCaptured?: () => void;
}

/** Shared capture boundary used by daemon dispatch and integration tests. */
export function capturePromptPayloads(input: CapturePromptObservationInput): void {
  if (input.systemPrompt) {
    spanPayloadRepo.put(input.spanId, 'system_prompt', input.systemPrompt);
  }
  spanPayloadRepo.put(input.spanId, 'assembled_prompt', input.assembledPrompt);
  input.onCaptured?.();
}
