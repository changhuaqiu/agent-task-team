import type { ChatMessage, ToolEvent } from '@/store/types';

export interface AgentOperationSummary {
  eventCount: number;
  operationCount: number;
  errorCount: number;
  isActive: boolean;
}
export interface AgentResponsePresentation {
  finalText: string;
  thinkingText: string;
  intermediateSegments: ChatMessage[];
  answerSegments: ChatMessage[];
  operation: AgentOperationSummary | null;
}

function compact(parts: Array<string | undefined>): string[] {
  return parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
}

function summarizeOperations(events: ToolEvent[], isActive: boolean): AgentOperationSummary | null {
  if (events.length === 0) return null;
  const started = events.filter((event) => event.type === 'tool_use').length;
  return {
    eventCount: events.length,
    operationCount: started || events.length,
    errorCount: events.filter((event) => event.type === 'error').length,
    isActive,
  };
}

/**
 * Converts canonical message segments into the three concepts the product exposes:
 * reasoning summary, final answer, and a compact operation receipt.
 */
export function projectAgentResponse(segments: ChatMessage[]): AgentResponsePresentation {
  const thinkingText = compact(segments.flatMap((segment) => [
    segment.thinking,
    segment.contentType === 'thinking' ? segment.content : undefined,
  ])).join('\n\n');
  const answerSegments = segments.filter((segment) => (
    segment.contentType !== 'thinking'
    && segment.contentType !== 'tool_use'
    && segment.contentType !== 'tool_result'
    && Boolean(segment.content.trim())
  ));
  const finalSegment = answerSegments.at(-1);
  const finalText = finalSegment?.content ?? '';
  const intermediateSegments = finalSegment
    ? answerSegments.filter((segment) => segment.id !== finalSegment.id)
    : [];
  const events = segments.flatMap((segment) => segment.toolEvents ?? []);

  return {
    finalText,
    thinkingText,
    intermediateSegments,
    answerSegments,
    operation: summarizeOperations(events, segments.some((segment) => segment.isStreaming === true)),
  };
}
