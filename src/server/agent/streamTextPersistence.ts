export interface StreamTextPersistenceSink {
  create(content: string): string;
  append(messageId: string, content: string): boolean;
}

/** Coalesces consecutive stream deltas while preserving explicit boundaries. */
export class StreamTextPersistence {
  private currentMessageId: string | undefined;

  constructor(private readonly sink: StreamTextPersistenceSink) {}

  appendChunk(content: string): { messageId?: string; created: boolean } {
    if (!content) return { messageId: this.currentMessageId, created: false };
    if (this.currentMessageId && this.sink.append(this.currentMessageId, content)) {
      return { messageId: this.currentMessageId, created: false };
    }
    this.currentMessageId = this.sink.create(content);
    return { messageId: this.currentMessageId, created: true };
  }

  closeSegment(): void {
    this.currentMessageId = undefined;
  }
}
