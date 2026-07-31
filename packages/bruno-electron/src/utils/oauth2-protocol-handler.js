const { getParamFromUrl } = require('./common');
const { getCurrentSessionKey } = require('@usebruno/requests');

// Keyed by the OAuth2 flow's `state` param (see oauth2.js's generateState()),
// not by Browser Bridge session, because the protocol callback URL that
// resolves a pending request carries only `state`, never a session
// identifier (see handleOauth2ProtocolUrl below) -- state is already
// generated to be unique per authorization attempt. Session scoping is
// layered on top of that: registerOauth2AuthorizationRequest only cancels an
// existing entry that belongs to the *same* session (getCurrentSessionKey(),
// undefined outside a Browser Bridge dispatch e.g. desktop mode), so two
// Browser Bridge sessions running concurrent OAuth2 flows no longer cancel
// or observe each other's in-flight request.
const pendingRequests = new Map();

const registerOauth2AuthorizationRequest = (resolve, reject, debugInfo = null, expectedState = null) => {
  const sessionKey = getCurrentSessionKey();

  // Cancel this caller's own previous pending request, if any -- preserves
  // the original "one flow at a time per caller" behavior without touching
  // other sessions' in-flight requests.
  for (const [key, entry] of pendingRequests) {
    if (entry.sessionKey === sessionKey) {
      pendingRequests.delete(key);
      entry.reject(new Error('Authorization cancelled: new request started'));
    }
  }

  pendingRequests.set(expectedState, {
    resolve,
    reject,
    debugInfo,
    expectedState,
    sessionKey,
    timestamp: Date.now()
  });
};

const isOauth2AuthorizationRequestInProgress = () => {
  const sessionKey = getCurrentSessionKey();
  for (const entry of pendingRequests.values()) {
    if (entry.sessionKey === sessionKey) return true;
  }
  return false;
};

const resolveOauth2AuthorizationRequest = (data, expectedState) => {
  const entry = pendingRequests.get(expectedState);
  if (entry) {
    pendingRequests.delete(expectedState);
    entry.resolve(data);
    return true;
  }
  return false;
};

const rejectOauth2AuthorizationRequest = (error, expectedState) => {
  const entry = pendingRequests.get(expectedState);
  if (entry) {
    pendingRequests.delete(expectedState);
    entry.reject(error);
    return true;
  }
  return false;
};

const cancelOAuth2AuthorizationRequest = () => {
  const sessionKey = getCurrentSessionKey();
  for (const [key, entry] of pendingRequests) {
    if (entry.sessionKey === sessionKey) {
      pendingRequests.delete(key);
      entry.reject(new Error('Authorization cancelled by user'));
      return true;
    }
  }
  return false;
};

const handleOauth2ProtocolUrl = (url) => {
  try {
    const urlObj = new URL(url);
    const returnedState = getParamFromUrl(urlObj, 'state');

    // This callback comes from an OS-level custom-protocol registration
    // (see deeplink.js), never from a Browser-Bridge HTTP request, so there
    // is no session context available to disambiguate which pending request
    // it belongs to -- `state` is the only correlator. A callback whose
    // state exactly matches a pending entry's is unambiguous. A callback
    // with a missing/forged state is only safe to attribute to the single
    // pending request when there IS only one (preserves the original
    // single-session desktop behavior of surfacing a clear error instead of
    // silently hanging); with multiple concurrent pending requests (only
    // possible with concurrent Browser Bridge sessions) it's ambiguous which
    // session's flow a bad callback was meant for, so it's dropped rather
    // than guessed at.
    let entry = pendingRequests.get(returnedState);
    if (!entry && pendingRequests.size === 1) {
      entry = pendingRequests.values().next().value;
    }

    // Add callback URL details to debugInfo if available
    if (entry?.debugInfo) {
      const callbackRequest = {
        request: {
          url: url,
          method: '',
          headers: {},
          error: null
        },
        response: {
          url: url,
          headers: {},
          status: '',
          statusText: 'BRUNO_OAUTH2_PROTOCOL',
          error: null
        },
        fromCache: false,
        completed: true
      };
      entry.debugInfo.data.push(callbackRequest);
    }

    // Check for errors in query params (authorization code flow) or hash (implicit flow)
    const error = getParamFromUrl(urlObj, 'error');
    const errorDescription = getParamFromUrl(urlObj, 'error_description');

    if (error) {
      if (!entry) return;
      const errorData = {
        message: 'Authorization Failed!',
        error,
        errorDescription
      };
      rejectOauth2AuthorizationRequest(new Error(JSON.stringify(errorData)), entry.expectedState);
      return;
    }

    // Validate the state parameter to protect against CSRF / authorization code
    // injection. State is always issued when a flow is initiated, so a missing
    // expected or returned state -- or one that doesn't match a request we're
    // actually waiting on -- means a forged/invalid/stale callback — fail closed.
    if (!entry || !entry.expectedState || entry.expectedState !== returnedState) {
      if (entry) {
        rejectOauth2AuthorizationRequest(
          new Error('OAuth2 state mismatch: the returned state does not match the issued state.'),
          entry.expectedState
        );
      }
      return;
    }

    // Check if this is an implicit grant (tokens in hash fragment)
    if (urlObj.hash) {
      const hash = urlObj.hash.substring(1); // Remove the leading #
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get('access_token');

      if (accessToken) {
        // Extract tokens from hash fragment for implicit grant
        const implicitTokens = {
          access_token: accessToken,
          token_type: hashParams.get('token_type'),
          expires_in: hashParams.get('expires_in'),
          state: hashParams.get('state'),
          scope: hashParams.get('scope')
        };
        resolveOauth2AuthorizationRequest(implicitTokens, entry.expectedState);
        return;
      }
    }

    // Check for authorization code in query params (authorization code flow)
    const code = urlObj.searchParams.get('code');
    if (code) {
      resolveOauth2AuthorizationRequest(code, entry.expectedState);
      return;
    }

    // No code or access_token found - reject with error
    rejectOauth2AuthorizationRequest(new Error('Invalid OAuth2 callback: missing code or access_token'), entry.expectedState);
  } catch (err) {
    console.error('Error handling protocol URL:', err);
  }
};

module.exports = {
  registerOauth2AuthorizationRequest,
  rejectOauth2AuthorizationRequest,
  cancelOAuth2AuthorizationRequest,
  isOauth2AuthorizationRequestInProgress,
  handleOauth2ProtocolUrl
};
