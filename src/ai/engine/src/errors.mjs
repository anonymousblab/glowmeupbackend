export class DomainError extends Error {
  constructor(code, message, status = 422, retryable = false) { super(message); this.name = 'DomainError'; this.code = code; this.status = status; this.retryable = retryable; }
}
export function ensure(ok, code = 'INVALID_INPUT', message = 'Input tidak valid.', status = 422) {
  if (!ok) throw new DomainError(code, message, status);
}
export function userId(principal) {
  // Principal MUST be supplied by a verified backend session adapter. This is not authentication.
  ensure(principal && typeof principal.userId === 'string' && principal.userId.length > 0, 'UNAUTHORIZED', 'Sesi backend diperlukan.', 401);
  return principal.userId;
}
export const copy = value => structuredClone(value);
