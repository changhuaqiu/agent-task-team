export class A2ACollaborationInvariantError extends Error {
  constructor(readonly reasonCode: string, detail: string) {
    super(`${reasonCode}: ${detail}`);
  }
}
