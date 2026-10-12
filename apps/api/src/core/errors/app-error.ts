import { type ErrorCode } from '@wewin/shared';

/** Business/API error with a stable code the UI can map (A§5). */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`, 404);

export const invalidState = (message: string, details?: unknown) =>
  new AppError('INVALID_STATE', message, 409, details);

export const versionConflict = () =>
  new AppError(
    'VERSION_CONFLICT',
    'This record was changed by someone else. Reload it and apply your changes again.',
    409,
  );
