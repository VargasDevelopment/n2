export class CliInputError extends Error {
  constructor(
    readonly code: 'invalid_json' | 'missing_input' | 'usage_error',
    message: string
  ) {
    super(message);
  }
}
