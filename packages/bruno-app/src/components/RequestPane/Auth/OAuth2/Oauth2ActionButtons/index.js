import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { cloneDeep, find, get } from 'lodash';
import { IconLoader2, IconX } from '@tabler/icons';
import { interpolate } from '@usebruno/common';
import { fetchOauth2Credentials, clearOauth2Cache, refreshOauth2Credentials, cancelOauth2AuthorizationRequest, isOauth2AuthorizationRequestInProgress } from 'providers/ReduxStore/slices/collections/actions';
import { responseReceived } from 'providers/ReduxStore/slices/collections';
import { updateResponsePaneTab } from 'providers/ReduxStore/slices/tabs';
import { getAllVariables } from 'utils/collections/index';
import { formatIpcError } from 'utils/common/error';
import { transport } from 'utils/common/ipc-transport';
import Button from 'ui/Button';
import Oauth2PopupBlockedModal from './PopupBlockedModal';

const Oauth2ActionButtons = ({ item, request, collection, url: accessTokenUrl, credentialsId }) => {
  const { uid: collectionUid } = collection;

  const dispatch = useDispatch();
  const preferences = useSelector((state) => state.app.preferences);
  const [fetchingToken, toggleFetchingToken] = useState(false);
  const [refreshingToken, toggleRefreshingToken] = useState(false);
  const [fetchingAuthorizationCode, toggleFetchingAuthorizationCode] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const popupWindowRef = useRef(null);
  const pendingAuthorizeUrlRef = useRef(null);

  const useSystemBrowser = get(preferences, 'request.oauth2.useSystemBrowser', false);

  // Improvement.md P1.5 — under the Browser Bridge, `oauth2:authorization-required`
  // is a WS push telling this tab to open the IdP's authorization URL itself
  // (the desktop equivalent is main-process shell.openExternal(), which
  // doesn't apply when there's no local OS to hand a URL to). window.open()
  // never throws when blocked; a null/immediately-closed return value is the
  // only signal available, so that's what drives the fallback modal below.
  useEffect(() => {
    const removeListener = transport.on('oauth2:authorization-required', ({ authorizeUrl }) => {
      const popup = window.open(authorizeUrl, 'bruno-oauth2-authorize', 'width=600,height=700');
      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        pendingAuthorizeUrlRef.current = authorizeUrl;
        setPopupBlocked(true);
        return;
      }
      popupWindowRef.current = popup;
      pendingAuthorizeUrlRef.current = null;
      setPopupBlocked(false);
    });

    return () => removeListener();
  }, []);

  const closeAuthorizationPopup = () => {
    if (popupWindowRef.current && !popupWindowRef.current.closed) {
      popupWindowRef.current.close();
    }
    popupWindowRef.current = null;
    pendingAuthorizeUrlRef.current = null;
    setPopupBlocked(false);
  };

  const handleOpenAuthorizationPopupManually = () => {
    const authorizeUrl = pendingAuthorizeUrlRef.current;
    if (!authorizeUrl) return;
    // A click handler is always a fresh user gesture, so this window.open()
    // is never blocked (unlike the WS-event-triggered one above).
    const popup = window.open(authorizeUrl, 'bruno-oauth2-authorize', 'width=600,height=700');
    if (popup) {
      popupWindowRef.current = popup;
      pendingAuthorizeUrlRef.current = null;
      setPopupBlocked(false);
    }
  };

  // Check for pending authorization when component mounts or when fetching starts
  useEffect(() => {
    if (useSystemBrowser && fetchingToken) {
      const getRequestStatus = async () => {
        try {
          toggleFetchingAuthorizationCode(await dispatch(isOauth2AuthorizationRequestInProgress()));
        } catch (err) {
          console.error('Error checking pending authorization:', err);
        }
      };
      getRequestStatus();
    }
  }, [useSystemBrowser, fetchingToken, dispatch]);

  const interpolatedAccessTokenUrl = useMemo(() => {
    const variables = getAllVariables(collection, item);
    return interpolate(accessTokenUrl, variables);
  }, [collection, item, accessTokenUrl]);

  const credentialsData = find(collection?.oauth2Credentials, (creds) => creds?.url == interpolatedAccessTokenUrl && creds?.collectionUid == collectionUid && creds?.credentialsId == credentialsId);
  const creds = credentialsData?.credentials || {};

  const showOauth2Error = (errorMessage) => {
    dispatch(
      responseReceived({
        itemUid: item.uid,
        collectionUid,
        response: {
          error: errorMessage,
          isError: true,
          status: 'Error',
          size: 0,
          duration: 0
        }
      })
    );
    dispatch(updateResponsePaneTab({ uid: item.uid, responsePaneTab: 'response' }));
  };

  const handleFetchOauth2Credentials = async () => {
    let requestCopy = cloneDeep(request);
    requestCopy.oauth2 = requestCopy?.auth.oauth2;
    requestCopy.headers = {};
    toggleFetchingToken(true);
    try {
      const result = await dispatch(fetchOauth2Credentials({
        itemUid: item.uid,
        request: requestCopy,
        collection,
        forceGetToken: true
      }));

      // Check if the result contains error or if access_token is missing
      if (!result || !result.access_token) {
        const errorMessage = result?.error || 'No access token received from authorization server';
        console.error(errorMessage);
        toast.error(errorMessage);
        showOauth2Error(errorMessage);
        return;
      }

      toast.success('Token fetched successfully!');
    } catch (error) {
      console.error('could not fetch the token!');
      console.error(error);
      // Don't show error toast for user cancellation
      if (error?.message && error.message.includes('cancelled by user')) {
        return;
      }
      const errorMessage = formatIpcError(error) || 'An error occurred while fetching token!';
      toast.error(errorMessage);
      showOauth2Error(errorMessage);
    } finally {
      toggleFetchingToken(false);
      toggleFetchingAuthorizationCode(false);
      closeAuthorizationPopup();
    }
  };

  const handleRefreshAccessToken = async () => {
    let requestCopy = cloneDeep(request);
    requestCopy.oauth2 = requestCopy?.auth.oauth2;
    requestCopy.headers = {};
    toggleRefreshingToken(true);
    try {
      const result = await dispatch(refreshOauth2Credentials({
        itemUid: item.uid,
        request: requestCopy,
        collection,
        forceGetToken: true
      }));

      toggleRefreshingToken(false);

      // Check if the result contains error or if access_token is missing
      if (!result || !result.access_token) {
        const errorMessage = result?.error || 'No access token received from authorization server';
        console.error(errorMessage);
        toast.error(errorMessage);
        return;
      }

      toast.success('Token refreshed successfully!');
    } catch (error) {
      console.error(error);
      toggleRefreshingToken(false);
      const errorMessage = formatIpcError(error) || 'An error occurred while refreshing token!';
      toast.error(errorMessage);
    }
  };

  const handleClearCache = (e) => {
    dispatch(clearOauth2Cache({ collectionUid: collection?.uid, url: interpolatedAccessTokenUrl, credentialsId }))
      .then(() => {
        toast.success('Cleared cache successfully');
      })
      .catch((err) => {
        toast.error(err.message);
      });
  };

  const handleCancelAuthorization = async () => {
    try {
      const result = await dispatch(cancelOauth2AuthorizationRequest());
      if (result.success && result.cancelled) {
        toast.error('Authorization cancelled');
        toggleFetchingToken(false);
        toggleFetchingAuthorizationCode(false);
      }
    } catch (err) {
      console.error('Error cancelling authorization:', err);
      toast.error('Failed to cancel authorization');
    } finally {
      closeAuthorizationPopup();
    }
  };

  return (
    <div className="flex flex-row gap-2 mt-4">
      {popupBlocked ? (
        <Oauth2PopupBlockedModal
          onOpen={handleOpenAuthorizationPopupManually}
          onCancel={handleCancelAuthorization}
        />
      ) : null}
      <Button
        size="sm"
        color="secondary"
        onClick={handleFetchOauth2Credentials}
        disabled={fetchingToken || refreshingToken}
        loading={fetchingToken}
      >
        Get Access Token
      </Button>
      {creds?.refresh_token
        ? (
            <Button
              size="sm"
              color="secondary"
              onClick={handleRefreshAccessToken}
              disabled={fetchingToken || refreshingToken}
              loading={refreshingToken}
            >
              Refresh Token
            </Button>
          )
        : null}
      {useSystemBrowser && fetchingAuthorizationCode
        ? (
            <Button
              size="sm"
              color="secondary"
              onClick={handleCancelAuthorization}
              icon={<IconX size={16} />}
              iconPosition="left"
            >
              Cancel Authorization
            </Button>
          ) : null}
      <Button
        size="sm"
        color="secondary"
        variant="ghost"
        onClick={handleClearCache}
      >
        Clear Cache
      </Button>
    </div>
  );
};

export default Oauth2ActionButtons;
