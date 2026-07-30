const { ERROR_CODES, createErrorEnvelope } = require('../error-envelope');

describe('error-envelope', () => {
  it('builds an envelope with defaults for optional fields', () => {
    const envelope = createErrorEnvelope(ERROR_CODES.HANDLER_NOT_FOUND, 'no handler for channel');
    expect(envelope).toEqual({
      code: ERROR_CODES.HANDLER_NOT_FOUND,
      message: 'no handler for channel',
      requestId: null,
      retryable: false,
      details: {}
    });
  });

  it('auto-classifies known retryable codes', () => {
    expect(createErrorEnvelope(ERROR_CODES.RATE_LIMITED, 'slow down').retryable).toBe(true);
    expect(createErrorEnvelope(ERROR_CODES.CONCURRENCY_LIMITED, 'busy').retryable).toBe(true);
    expect(createErrorEnvelope(ERROR_CODES.HANDLER_TIMEOUT, 'timed out').retryable).toBe(true);
  });

  it('defaults non-retryable codes to retryable: false', () => {
    expect(createErrorEnvelope(ERROR_CODES.INVALID_ARGS, 'bad args').retryable).toBe(false);
    expect(createErrorEnvelope(ERROR_CODES.PRIVILEGED_CHANNEL_DISABLED, 'nope').retryable).toBe(false);
  });

  it('lets the caller override retryable and pass requestId/details', () => {
    const envelope = createErrorEnvelope(ERROR_CODES.GENERIC_ERROR, 'oops', {
      requestId: 'req-1',
      retryable: true,
      details: { channel: 'renderer:ready' }
    });
    expect(envelope).toEqual({
      code: ERROR_CODES.GENERIC_ERROR,
      message: 'oops',
      requestId: 'req-1',
      retryable: true,
      details: { channel: 'renderer:ready' }
    });
  });

  it('freezes ERROR_CODES as a stable enum', () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
  });
});
