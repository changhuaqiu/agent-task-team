import type { AgentEvent } from '../agent/types';
import type { RuntimeEventPayload, RuntimeEventType } from '../platform-events/types';

export type RuntimeEventSink = <TType extends RuntimeEventType>(
  type: TType,
  payload: RuntimeEventPayload<TType>,
) => void;

export interface AcpTurnEventNormalizerOptions {
  invocationId: string;
  publish: RuntimeEventSink;
  isPlatformTool?: (toolName: string) => boolean;
}

/** Turn-local ACP/AgentEvent normalization into canonical runtime.* events. */
export class AcpTurnEventNormalizer {
  private messageSegment = 0;
  private thinkingSegment = 0;
  private textBuffer = '';
  private thinkingBuffer = '';
  private toolSequence = 0;
  private readonly toolCalls = new Map<string, string[]>();
  private readonly isPlatformTool: (toolName: string) => boolean;

  constructor(private readonly options: AcpTurnEventNormalizerOptions) {
    this.isPlatformTool = options.isPlatformTool ?? (() => false);
  }

  publish(event: AgentEvent): void {
    this.closeOtherSegment(event.type);
    switch (event.type) {
      case 'text': this.textBuffer += event.content; break;
      case 'thinking': this.thinkingBuffer += event.content; break;
      case 'plan':
        this.options.publish('runtime.plan.updated', { content: event.content });
        break;
      case 'tool_use':
        if (event.tool) {
          this.options.publish('runtime.tool.started', {
            callId: this.toolCallId(event, 'started'),
            toolName: event.tool.name,
            input: event.tool.input,
            origin: this.isPlatformTool(event.tool.name) ? 'platform' : 'runtime',
          });
        }
        break;
      case 'tool_result':
        if (event.tool) {
          if (event.tool.status === 'pending' || event.tool.status === 'in_progress') break;
          const callId = this.toolCallId(event, 'completed');
          if (event.tool.status === 'failed') {
            this.options.publish('runtime.tool.failed', {
              callId,
              toolName: event.tool.name,
              reasonCode: 'runtime_tool_failed',
              message: event.tool.output ?? event.content,
            });
          } else {
            this.options.publish('runtime.tool.completed', {
              callId,
              toolName: event.tool.name,
              output: event.tool.output ?? event.content,
            });
          }
        }
        break;
      case 'error':
        this.options.publish('runtime.diagnostic.observed', {
          severity: 'error', reasonCode: 'adapter_event_error', message: event.content,
        });
        if (/(websockets?.*(?:fallback|falling back)|falling back.*https|reconnecting)/i.test(event.content)) {
          this.options.publish('runtime.transport.degraded', {
            transport: 'websocket',
            fallbackTransport: /https/i.test(event.content) ? 'https' : undefined,
            reasonCode: 'runtime_transport_degraded',
            message: event.content,
          });
        } else if (/(websockets?.*(?:recovered|connected)|transport recovered)/i.test(event.content)) {
          this.options.publish('runtime.transport.recovered', {
            transport: 'websocket', reasonCode: 'runtime_transport_recovered',
          });
        }
        break;
      case 'done': this.flush(); break;
    }
    if (event.usage) this.options.publish('runtime.usage.updated', event.usage);
  }

  flush(): void {
    this.flushText();
    this.flushThinking();
  }

  private closeOtherSegment(eventType: AgentEvent['type']): void {
    if (eventType !== 'text') this.flushText();
    if (eventType !== 'thinking') this.flushThinking();
  }

  private flushText(): void {
    if (!this.textBuffer) return;
    this.options.publish('runtime.message.segment.completed', {
      segmentId: `${this.options.invocationId}:message:${this.messageSegment}`,
      text: this.textBuffer,
    });
    this.textBuffer = '';
    this.messageSegment += 1;
  }

  private flushThinking(): void {
    if (!this.thinkingBuffer) return;
    this.options.publish('runtime.thinking.segment.completed', {
      segmentId: `${this.options.invocationId}:thinking:${this.thinkingSegment}`,
      text: this.thinkingBuffer,
    });
    this.thinkingBuffer = '';
    this.thinkingSegment += 1;
  }

  private toolCallId(event: AgentEvent, phase: 'started' | 'completed'): string {
    const explicit = event.tool?.callId;
    if (explicit) return explicit;
    const toolName = event.tool?.name || 'Tool';
    const pending = this.toolCalls.get(toolName) ?? [];
    if (phase === 'completed' && pending.length > 0) {
      const callId = pending.shift()!;
      if (pending.length > 0) this.toolCalls.set(toolName, pending);
      else this.toolCalls.delete(toolName);
      return callId;
    }
    const callId = `${this.options.invocationId}:legacy-tool:${++this.toolSequence}`;
    this.toolCalls.set(toolName, [...pending, callId]);
    return callId;
  }
}
