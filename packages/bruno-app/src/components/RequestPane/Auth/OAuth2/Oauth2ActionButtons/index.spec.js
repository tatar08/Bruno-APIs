import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import Oauth2ActionButtons from './index';

const mockTransportOn = jest.fn(() => jest.fn());
jest.mock('utils/common/ipc-transport', () => ({
  transport: {
    on: (...args) => mockTransportOn(...args)
  }
}));

const mockFetchOauth2Credentials = jest.fn(() => ({ type: 'noop/fetchOauth2Credentials' }));
const mockCancelOauth2AuthorizationRequest = jest.fn(() => ({ type: 'noop/cancel' }));
jest.mock('providers/ReduxStore/slices/collections/actions', () => ({
  fetchOauth2Credentials: (...args) => mockFetchOauth2Credentials(...args),
  clearOauth2Cache: jest.fn(() => ({ type: 'noop/clearCache' })),
  refreshOauth2Credentials: jest.fn(() => ({ type: 'noop/refresh' })),
  cancelOauth2AuthorizationRequest: (...args) => mockCancelOauth2AuthorizationRequest(...args),
  isOauth2AuthorizationRequestInProgress: jest.fn(() => ({ type: 'noop/inProgress' }))
}));

jest.mock('components/Modal/index', () => ({
  __esModule: true,
  default: (props) => (
    <div data-testid="mock-modal">
      <div>{props.title}</div>
      {props.children}
      <button data-testid="modal-confirm-btn" onClick={props.handleConfirm}>
        {props.confirmText}
      </button>
      <button data-testid="modal-cancel-btn" onClick={() => props.handleCancel()}>
        {props.cancelText}
      </button>
    </div>
  )
}));

jest.mock('components/Portal/index', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="portal-root">{children}</div>
}));

jest.mock('ui/Button', () => ({
  __esModule: true,
  default: ({ children, onClick, disabled }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}));

const mockStore = configureStore({
  reducer: {
    app: (state = { preferences: {} }) => state
  }
});

const renderComponent = () =>
  render(
    <Provider store={mockStore}>
      <Oauth2ActionButtons
        item={{ uid: 'item-1' }}
        request={{ auth: { oauth2: {} } }}
        collection={{ uid: 'col-1', oauth2Credentials: [] }}
        url="https://example.com/token"
        credentialsId="creds-1"
      />
    </Provider>
  );

const getRegisteredHandler = () => {
  const call = mockTransportOn.mock.calls.find(([channel]) => channel === 'oauth2:authorization-required');
  return call?.[1];
};

describe('Oauth2ActionButtons — popup-blocked OAuth fallback UI (Improvement.md P1.5)', () => {
  let originalOpen;

  beforeEach(() => {
    mockTransportOn.mockClear();
    mockFetchOauth2Credentials.mockClear();
    mockCancelOauth2AuthorizationRequest.mockClear();
    originalOpen = window.open;
  });

  afterEach(() => {
    window.open = originalOpen;
  });

  it('subscribes to the oauth2:authorization-required event on mount', () => {
    renderComponent();
    expect(mockTransportOn).toHaveBeenCalledWith('oauth2:authorization-required', expect.any(Function));
  });

  it('does not show the fallback modal when the popup opens successfully', () => {
    window.open = jest.fn(() => ({ closed: false }));
    renderComponent();

    const handler = getRegisteredHandler();
    act(() => {
      handler({ authorizeUrl: 'https://idp.example.com/authorize', expectedState: 'state-1' });
    });

    expect(window.open).toHaveBeenCalledWith(
      'https://idp.example.com/authorize',
      'bruno-oauth2-authorize',
      'width=600,height=700'
    );
    expect(screen.queryByText('Authorization Popup Blocked')).not.toBeInTheDocument();
  });

  it('shows the fallback modal when window.open returns null (blocked)', () => {
    window.open = jest.fn(() => null);
    renderComponent();

    const handler = getRegisteredHandler();
    act(() => {
      handler({ authorizeUrl: 'https://idp.example.com/authorize', expectedState: 'state-1' });
    });

    expect(screen.getByText('Authorization Popup Blocked')).toBeInTheDocument();
  });

  it('shows the fallback modal when window.open returns an immediately-closed window', () => {
    window.open = jest.fn(() => ({ closed: true }));
    renderComponent();

    const handler = getRegisteredHandler();
    act(() => {
      handler({ authorizeUrl: 'https://idp.example.com/authorize', expectedState: 'state-1' });
    });

    expect(screen.getByText('Authorization Popup Blocked')).toBeInTheDocument();
  });

  it('clicking "Open Authorization Page" retries window.open as a direct user gesture and clears the modal on success', () => {
    window.open = jest.fn(() => null);
    renderComponent();

    const handler = getRegisteredHandler();
    act(() => {
      handler({ authorizeUrl: 'https://idp.example.com/authorize', expectedState: 'state-1' });
    });
    expect(screen.getByText('Authorization Popup Blocked')).toBeInTheDocument();

    window.open = jest.fn(() => ({ closed: false }));
    fireEvent.click(screen.getByTestId('modal-confirm-btn'));

    expect(window.open).toHaveBeenCalledWith(
      'https://idp.example.com/authorize',
      'bruno-oauth2-authorize',
      'width=600,height=700'
    );
    expect(screen.queryByText('Authorization Popup Blocked')).not.toBeInTheDocument();
  });

  it('clicking Cancel in the fallback modal dispatches cancelOauth2AuthorizationRequest and closes the modal', async () => {
    window.open = jest.fn(() => null);
    renderComponent();

    const handler = getRegisteredHandler();
    act(() => {
      handler({ authorizeUrl: 'https://idp.example.com/authorize', expectedState: 'state-1' });
    });
    expect(screen.getByText('Authorization Popup Blocked')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('modal-cancel-btn'));
    });

    expect(mockCancelOauth2AuthorizationRequest).toHaveBeenCalled();
    expect(screen.queryByText('Authorization Popup Blocked')).not.toBeInTheDocument();
  });

  it('closes an open popup when the token fetch completes', async () => {
    const closeSpy = jest.fn();
    window.open = jest.fn(() => ({ closed: false, close: closeSpy }));
    renderComponent();

    const handler = getRegisteredHandler();
    act(() => {
      handler({ authorizeUrl: 'https://idp.example.com/authorize', expectedState: 'state-1' });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Get Access Token'));
    });

    expect(mockFetchOauth2Credentials).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
  });
});
