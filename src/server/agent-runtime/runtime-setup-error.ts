export class RuntimeSetupError extends Error {
  constructor(
    readonly reasonCode: 'runtime_model_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeSetupError';
  }
}
