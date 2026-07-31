const { runWithSessionKey } = require('@usebruno/requests');
const {
  registerOauth2AuthorizationRequest,
  handleOauth2ProtocolUrl,
  cancelOAuth2AuthorizationRequest,
  isOauth2AuthorizationRequestInProgress
} = require('../../src/utils/oauth2-protocol-handler');

describe('handleOauth2ProtocolUrl - state validation', () => {
  let resolve;
  let reject;

  beforeEach(() => {
    resolve = jest.fn();
    reject = jest.fn();
  });

  afterEach(() => {
    // Clear any pending request between tests
    if (isOauth2AuthorizationRequestInProgress()) {
      cancelOAuth2AuthorizationRequest();
    }
    jest.clearAllMocks();
  });

  describe('authorization code flow (state in query params)', () => {
    it('should resolve with the code when the returned state matches', () => {
      registerOauth2AuthorizationRequest(resolve, reject, null, 'expected-state');

      handleOauth2ProtocolUrl('bruno://app/oauth2/callback?code=auth-code-123&state=expected-state');

      expect(resolve).toHaveBeenCalledWith('auth-code-123');
      expect(reject).not.toHaveBeenCalled();
    });

    it('should reject when the returned state does not match', () => {
      registerOauth2AuthorizationRequest(resolve, reject, null, 'expected-state');

      handleOauth2ProtocolUrl('bruno://app/oauth2/callback?code=auth-code-123&state=attacker-state');

      expect(resolve).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('state mismatch') })
      );
    });

    it('should reject when no state is returned but one was expected', () => {
      registerOauth2AuthorizationRequest(resolve, reject, null, 'expected-state');

      handleOauth2ProtocolUrl('bruno://app/oauth2/callback?code=auth-code-123');

      expect(resolve).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('state mismatch') })
      );
    });
  });

  describe('implicit flow (state in hash fragment)', () => {
    it('should resolve with tokens when the returned state matches', () => {
      registerOauth2AuthorizationRequest(resolve, reject, null, 'expected-state');

      handleOauth2ProtocolUrl(
        'bruno://app/oauth2/callback#access_token=token-abc&token_type=bearer&state=expected-state'
      );

      expect(resolve).toHaveBeenCalledWith(
        expect.objectContaining({ access_token: 'token-abc' })
      );
      expect(reject).not.toHaveBeenCalled();
    });

    it('should reject when the hash state does not match', () => {
      registerOauth2AuthorizationRequest(resolve, reject, null, 'expected-state');

      handleOauth2ProtocolUrl(
        'bruno://app/oauth2/callback#access_token=token-abc&token_type=bearer&state=attacker-state'
      );

      expect(resolve).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('state mismatch') })
      );
    });

    it('should reject when no hash state is returned but one was expected', () => {
      registerOauth2AuthorizationRequest(resolve, reject, null, 'expected-state');

      handleOauth2ProtocolUrl(
        'bruno://app/oauth2/callback#access_token=token-abc&token_type=bearer'
      );

      expect(resolve).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('state mismatch') })
      );
    });
  });

  describe('when no expected state was registered', () => {
    it('should reject rather than resolve without state (fail closed)', () => {
      registerOauth2AuthorizationRequest(resolve, reject, null, null);

      handleOauth2ProtocolUrl('bruno://app/oauth2/callback?code=auth-code-123');

      expect(resolve).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('state mismatch') })
      );
    });
  });

  describe('error responses are handled before state validation', () => {
    it('should reject with the provider error even if state is absent', () => {
      registerOauth2AuthorizationRequest(resolve, reject, null, 'expected-state');

      handleOauth2ProtocolUrl('bruno://app/oauth2/callback?error=access_denied');

      expect(resolve).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Authorization Failed') })
      );
    });

    it('should reject with the provider error in the hash fragment even if state is absent', () => {
      registerOauth2AuthorizationRequest(resolve, reject, null, 'expected-state');

      handleOauth2ProtocolUrl('bruno://app/oauth2/callback#error=access_denied');

      expect(resolve).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Authorization Failed') })
      );
    });
  });
});

describe('OAuth2 pending-request isolation across Browser Bridge sessions', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('registering a request in one session does not cancel another session\'s pending request', () => {
    const resolveA = jest.fn();
    const rejectA = jest.fn();
    const resolveB = jest.fn();
    const rejectB = jest.fn();

    runWithSessionKey('session-A', () => {
      registerOauth2AuthorizationRequest(resolveA, rejectA, null, 'state-A');
    });
    runWithSessionKey('session-B', () => {
      registerOauth2AuthorizationRequest(resolveB, rejectB, null, 'state-B');
    });

    expect(rejectA).not.toHaveBeenCalled();
    expect(rejectB).not.toHaveBeenCalled();

    // clean up
    handleOauth2ProtocolUrl('bruno://app/oauth2/callback?code=code-A&state=state-A');
    handleOauth2ProtocolUrl('bruno://app/oauth2/callback?code=code-B&state=state-B');
    expect(resolveA).toHaveBeenCalledWith('code-A');
    expect(resolveB).toHaveBeenCalledWith('code-B');
  });

  it('a second request in the SAME session still cancels that session\'s own previous pending request', () => {
    const resolveFirst = jest.fn();
    const rejectFirst = jest.fn();
    const resolveSecond = jest.fn();
    const rejectSecond = jest.fn();

    runWithSessionKey('session-A', () => {
      registerOauth2AuthorizationRequest(resolveFirst, rejectFirst, null, 'state-first');
      registerOauth2AuthorizationRequest(resolveSecond, rejectSecond, null, 'state-second');
    });

    expect(rejectFirst).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('new request started') })
    );
    expect(rejectSecond).not.toHaveBeenCalled();

    handleOauth2ProtocolUrl('bruno://app/oauth2/callback?code=code-second&state=state-second');
    expect(resolveSecond).toHaveBeenCalledWith('code-second');
  });

  it('cancelOAuth2AuthorizationRequest only cancels the calling session\'s own pending request', () => {
    const resolveA = jest.fn();
    const rejectA = jest.fn();
    const resolveB = jest.fn();
    const rejectB = jest.fn();

    runWithSessionKey('session-A', () => {
      registerOauth2AuthorizationRequest(resolveA, rejectA, null, 'state-A');
    });
    runWithSessionKey('session-B', () => {
      registerOauth2AuthorizationRequest(resolveB, rejectB, null, 'state-B');
    });

    runWithSessionKey('session-A', () => {
      cancelOAuth2AuthorizationRequest();
    });

    expect(rejectA).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('cancelled by user') })
    );
    expect(rejectB).not.toHaveBeenCalled();

    // clean up B
    runWithSessionKey('session-B', () => {
      cancelOAuth2AuthorizationRequest();
    });
    expect(rejectB).toHaveBeenCalled();
  });

  it('isOauth2AuthorizationRequestInProgress is scoped to the calling session', () => {
    const resolveA = jest.fn();
    const rejectA = jest.fn();

    runWithSessionKey('session-A', () => {
      registerOauth2AuthorizationRequest(resolveA, rejectA, null, 'state-A');
    });

    runWithSessionKey('session-A', () => {
      expect(isOauth2AuthorizationRequestInProgress()).toBe(true);
    });
    runWithSessionKey('session-B', () => {
      expect(isOauth2AuthorizationRequestInProgress()).toBe(false);
    });
    expect(isOauth2AuthorizationRequestInProgress()).toBe(false); // no session context at all

    runWithSessionKey('session-A', () => {
      cancelOAuth2AuthorizationRequest();
    });
  });

  it('handleOauth2ProtocolUrl resolves the correct session\'s request when multiple are pending concurrently', () => {
    const resolveA = jest.fn();
    const rejectA = jest.fn();
    const resolveB = jest.fn();
    const rejectB = jest.fn();

    runWithSessionKey('session-A', () => {
      registerOauth2AuthorizationRequest(resolveA, rejectA, null, 'state-A');
    });
    runWithSessionKey('session-B', () => {
      registerOauth2AuthorizationRequest(resolveB, rejectB, null, 'state-B');
    });

    // Only B's callback arrives; A must remain untouched and still pending.
    handleOauth2ProtocolUrl('bruno://app/oauth2/callback?code=code-B&state=state-B');

    expect(resolveB).toHaveBeenCalledWith('code-B');
    expect(resolveA).not.toHaveBeenCalled();
    expect(rejectA).not.toHaveBeenCalled();

    runWithSessionKey('session-A', () => {
      expect(isOauth2AuthorizationRequestInProgress()).toBe(true);
      cancelOAuth2AuthorizationRequest();
    });
  });
});
