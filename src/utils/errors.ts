export type CashBlocksErrorCode = 'INVALID_PARAM' | 'COMPOSER_FAILED' | 'VALIDATION_FAILED';

export class CashBlocksError extends Error {
  constructor(
    message: string,
    public readonly code: CashBlocksErrorCode,
  ) {
    super(message);
    this.name = 'CashBlocksError';
  }
}
