import React from 'react';
import Modal from 'components/Modal/index';
import Portal from 'components/Portal/index';

// Improvement.md P1.5 — under the Browser Bridge, the authorization popup is
// opened asynchronously in response to a WebSocket push event
// (`oauth2:authorization-required`), not synchronously inside the "Get
// Access Token" click handler itself. By the time that event round-trips
// through the server, most browsers have already expired the click's
// transient user-activation window and silently block window.open(). This
// modal's "Open Authorization Page" button is a direct click, so it always
// counts as a fresh user gesture and the browser allows it.
const Oauth2PopupBlockedModal = ({ onOpen, onCancel }) => (
  <Portal>
    <Modal
      size="sm"
      title="Authorization Popup Blocked"
      confirmText="Open Authorization Page"
      cancelText="Cancel"
      handleConfirm={onOpen}
      handleCancel={onCancel}
      hideClose
    >
      <p>Your browser blocked the OAuth2 authorization popup.</p>
      <p className="mt-2">Click below to open it manually and continue signing in.</p>
    </Modal>
  </Portal>
);

export default Oauth2PopupBlockedModal;
