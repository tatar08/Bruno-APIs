import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import BrowseFolderModal from './index';
import { transport } from 'utils/common/ipc-transport';

const theme = {
  text: '#333',
  modal: { input: { border: '#ccc', bg: '#fff' } },
  colors: { text: { yellow: '#e0a500', muted: '#888' } },
  table: { striped: '#f5f5f5' }
};

const renderModal = (props = {}) =>
  render(
    <ThemeProvider theme={theme}>
      <BrowseFolderModal onSubmit={jest.fn()} onCancel={jest.fn()} {...props} />
    </ThemeProvider>
  );

jest.mock('utils/common/ipc-transport', () => ({
  transport: { invoke: jest.fn() }
}));

jest.mock('components/Portal', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="portal-root">{children}</div>
}));

jest.mock('components/Modal', () => ({
  __esModule: true,
  default: (props) => (
    <div data-testid="mock-modal">
      {props.children}
      <button data-testid="modal-confirm-btn" disabled={props.confirmDisabled} onClick={props.handleConfirm}>
        {props.confirmText}
      </button>
      <button data-testid="modal-cancel-btn" onClick={props.handleCancel}>
        cancel
      </button>
    </div>
  )
}));

const listing = (path, entries = []) => ({
  path,
  parentPath: path === '/root' ? null : '/root',
  entries: entries.map((name) => ({ name, path: `${path}/${name}`, isDirectory: true }))
});

const mixedListing = (path, dirNames = [], files = []) => ({
  path,
  parentPath: path === '/root' ? null : '/root',
  entries: [
    ...dirNames.map((name) => ({ name, path: `${path}/${name}`, isDirectory: true })),
    ...files.map((f) => ({
      name: f.name,
      path: `${path}/${f.name}`,
      isDirectory: false,
      size: f.size,
      mtimeMs: f.mtimeMs
    }))
  ]
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BrowseFolderModal create-folder / rename (Improvement.md P1.1)', () => {
  it('lists subfolders on mount', async () => {
    transport.invoke.mockResolvedValueOnce(listing('/root', ['Alpha', 'Beta']));
    renderModal();

    expect(await screen.findAllByTestId('browse-folder-entry')).toHaveLength(2);
    expect(transport.invoke).toHaveBeenCalledWith('renderer:list-directory', null);
  });

  describe('create folder', () => {
    it('creates a folder and refreshes the listing', async () => {
      transport.invoke.mockResolvedValueOnce(listing('/root', []));
      renderModal();
      await waitFor(() => expect(screen.getByTestId('browse-folder-new-folder-btn')).not.toBeDisabled());

      fireEvent.click(screen.getByTestId('browse-folder-new-folder-btn'));
      fireEvent.change(screen.getByTestId('browse-folder-new-folder-input'), {
        target: { value: 'New Folder' }
      });

      transport.invoke.mockResolvedValueOnce({ path: '/root/New Folder', name: 'New Folder', parentPath: '/root' });
      transport.invoke.mockResolvedValueOnce(listing('/root', ['New Folder']));

      fireEvent.click(screen.getByTestId('browse-folder-new-folder-confirm'));

      await waitFor(() =>
        expect(transport.invoke).toHaveBeenCalledWith('renderer:create-directory', '/root', 'New Folder')
      );
      await waitFor(() => expect(screen.queryByTestId('browse-folder-new-folder-input')).not.toBeInTheDocument());
      expect(await screen.findAllByTestId('browse-folder-entry')).toHaveLength(1);
    });

    it('shows an inline conflict error and keeps the form open', async () => {
      transport.invoke.mockResolvedValueOnce(listing('/root', ['Existing']));
      renderModal();
      await waitFor(() => expect(screen.getByTestId('browse-folder-new-folder-btn')).not.toBeDisabled());

      fireEvent.click(screen.getByTestId('browse-folder-new-folder-btn'));
      fireEvent.change(screen.getByTestId('browse-folder-new-folder-input'), {
        target: { value: 'Existing' }
      });

      transport.invoke.mockRejectedValueOnce(new Error('path: /root/Existing already exists'));
      fireEvent.click(screen.getByTestId('browse-folder-new-folder-confirm'));

      expect(await screen.findByTestId('browse-folder-new-folder-error')).toHaveTextContent('already exists');
      expect(screen.getByTestId('browse-folder-new-folder-input')).toBeInTheDocument();
    });

    it('cancels the create-folder form on Escape', async () => {
      transport.invoke.mockResolvedValueOnce(listing('/root', []));
      renderModal();
      await waitFor(() => expect(screen.getByTestId('browse-folder-new-folder-btn')).not.toBeDisabled());

      fireEvent.click(screen.getByTestId('browse-folder-new-folder-btn'));
      fireEvent.keyDown(screen.getByTestId('browse-folder-new-folder-input'), { key: 'Escape' });

      expect(screen.queryByTestId('browse-folder-new-folder-input')).not.toBeInTheDocument();
    });
  });

  describe('rename', () => {
    it('renames a folder and refreshes the listing', async () => {
      transport.invoke.mockResolvedValueOnce(listing('/root', ['Old Name']));
      renderModal();
      await screen.findByTestId('browse-folder-rename-btn');

      fireEvent.click(screen.getByTestId('browse-folder-rename-btn'));
      fireEvent.change(screen.getByTestId('browse-folder-rename-input'), {
        target: { value: 'New Name' }
      });

      transport.invoke.mockResolvedValueOnce({ path: '/root/New Name', name: 'New Name', parentPath: '/root' });
      transport.invoke.mockResolvedValueOnce(listing('/root', ['New Name']));

      fireEvent.click(screen.getByTestId('browse-folder-rename-confirm'));

      await waitFor(() =>
        expect(transport.invoke).toHaveBeenCalledWith(
          'renderer:rename-directory',
          '/root/Old Name',
          'New Name'
        )
      );
      await waitFor(() => expect(screen.queryByTestId('browse-folder-rename-input')).not.toBeInTheDocument());
      expect(screen.getByText('New Name')).toBeInTheDocument();
    });

    it('shows an inline conflict error and keeps the form open', async () => {
      transport.invoke.mockResolvedValueOnce(listing('/root', ['Source', 'Taken']));
      renderModal();
      await (await screen.findAllByTestId('browse-folder-rename-btn'))[0];

      fireEvent.click(screen.getAllByTestId('browse-folder-rename-btn')[0]);
      fireEvent.change(screen.getByTestId('browse-folder-rename-input'), {
        target: { value: 'Taken' }
      });

      transport.invoke.mockRejectedValueOnce(new Error('path: /root/Taken already exists'));
      fireEvent.click(screen.getByTestId('browse-folder-rename-confirm'));

      expect(await screen.findByTestId('browse-folder-rename-error')).toHaveTextContent('already exists');
      expect(screen.getByTestId('browse-folder-rename-input')).toBeInTheDocument();
    });

    it('cancels the rename form on Escape', async () => {
      transport.invoke.mockResolvedValueOnce(listing('/root', ['Old Name']));
      renderModal();
      await screen.findByTestId('browse-folder-rename-btn');

      fireEvent.click(screen.getByTestId('browse-folder-rename-btn'));
      fireEvent.keyDown(screen.getByTestId('browse-folder-rename-input'), { key: 'Escape' });

      expect(screen.queryByTestId('browse-folder-rename-input')).not.toBeInTheDocument();
      expect(screen.getByText('Old Name')).toBeInTheDocument();
    });

    it('does not submit when the new name is unchanged', async () => {
      transport.invoke.mockResolvedValueOnce(listing('/root', ['Old Name']));
      renderModal();
      await screen.findByTestId('browse-folder-rename-btn');

      fireEvent.click(screen.getByTestId('browse-folder-rename-btn'));
      fireEvent.click(screen.getByTestId('browse-folder-rename-confirm'));

      await waitFor(() => expect(screen.queryByTestId('browse-folder-rename-input')).not.toBeInTheDocument());
      expect(transport.invoke).not.toHaveBeenCalledWith(
        'renderer:rename-directory',
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('file picker mode (Improvement.md P1.1 multi-select + preview)', () => {
    it('does not show files when mode is the default "folders"', async () => {
      transport.invoke.mockResolvedValueOnce(
        mixedListing('/root', ['Docs'], [{ name: 'notes.txt', size: 12 }])
      );
      renderModal();

      expect(await screen.findAllByTestId('browse-folder-entry')).toHaveLength(1);
      expect(screen.queryByTestId('browse-file-entry')).not.toBeInTheDocument();
    });

    it('lists both folders and files in file mode', async () => {
      transport.invoke.mockResolvedValueOnce(
        mixedListing('/root', ['Docs'], [{ name: 'notes.txt', size: 12 }, { name: 'photo.png', size: 2048 }])
      );
      renderModal({ mode: 'files' });

      expect(await screen.findAllByTestId('browse-folder-entry')).toHaveLength(3);
      expect(screen.getAllByTestId('browse-file-entry')).toHaveLength(2);
    });

    it('filters files by extension using the filters prop', async () => {
      transport.invoke.mockResolvedValueOnce(
        mixedListing('/root', [], [{ name: 'notes.txt', size: 12 }, { name: 'photo.png', size: 2048 }])
      );
      renderModal({ mode: 'files', filters: [{ name: 'Images', extensions: ['png'] }] });

      const fileEntries = await screen.findAllByTestId('browse-file-entry');
      expect(fileEntries).toHaveLength(1);
      expect(screen.getByText('photo.png')).toBeInTheDocument();
      expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
    });

    it('selects a single file and enables Select, showing it in the preview panel', async () => {
      transport.invoke.mockResolvedValueOnce(
        mixedListing('/root', [], [{ name: 'notes.txt', size: 12, mtimeMs: 1700000000000 }])
      );
      renderModal({ mode: 'files' });

      await screen.findByTestId('browse-file-entry');
      expect(screen.getByTestId('modal-confirm-btn')).toBeDisabled();

      fireEvent.click(screen.getByTestId('browse-file-checkbox'));

      expect(screen.getByTestId('modal-confirm-btn')).not.toBeDisabled();
      expect(screen.getByTestId('browse-file-preview')).toHaveTextContent('notes.txt');
    });

    it('submits the selected file paths on confirm', async () => {
      const onSubmit = jest.fn();
      transport.invoke.mockResolvedValueOnce(mixedListing('/root', [], [{ name: 'notes.txt', size: 12 }]));
      renderModal({ mode: 'files', onSubmit });

      fireEvent.click(await screen.findByTestId('browse-file-checkbox'));
      fireEvent.click(screen.getByTestId('modal-confirm-btn'));

      expect(onSubmit).toHaveBeenCalledWith(['/root/notes.txt']);
    });

    it('selects multiple files when multiple is true', async () => {
      const onSubmit = jest.fn();
      transport.invoke.mockResolvedValueOnce(
        mixedListing('/root', [], [{ name: 'a.txt', size: 1 }, { name: 'b.txt', size: 2 }])
      );
      renderModal({ mode: 'files', multiple: true, onSubmit });

      const checkboxes = await screen.findAllByTestId('browse-file-checkbox');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);
      fireEvent.click(screen.getByTestId('modal-confirm-btn'));

      expect(onSubmit).toHaveBeenCalledWith(['/root/a.txt', '/root/b.txt']);
    });
  });
});
