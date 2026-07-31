const Store = require('electron-store');
const { getCurrentSessionKey } = require('@usebruno/requests');

class LastOpenedWorkspaces {
  constructor() {
    this.store = new Store({
      name: 'preferences',
      defaults: {}
    });
  }

  // Falls back to the single flat list when there's no session context
  // (desktop/no-auth mode, getCurrentSessionKey() always undefined --
  // unchanged behavior for that case). In Browser Bridge mode, each session
  // gets its own list keyed by session, so one session's landing view isn't
  // populated by -- or overwritten by -- another session's workspace history
  // (Improvement.md P0.4).
  getAll() {
    const sessionKey = getCurrentSessionKey();
    if (!sessionKey) {
      return this.store.get('workspaces.lastOpenedWorkspaces', []);
    }
    const bySession = this.store.get('workspaces.lastOpenedWorkspacesBySession', {});
    return bySession[sessionKey] || [];
  }

  #setAll(workspaces) {
    const sessionKey = getCurrentSessionKey();
    if (!sessionKey) {
      this.store.set('workspaces.lastOpenedWorkspaces', workspaces);
      return;
    }
    const bySession = this.store.get('workspaces.lastOpenedWorkspacesBySession', {});
    bySession[sessionKey] = workspaces;
    this.store.set('workspaces.lastOpenedWorkspacesBySession', bySession);
  }

  add(workspacePath) {
    const workspaces = this.getAll();

    if (workspaces.includes(workspacePath)) {
      return workspaces;
    }

    workspaces.unshift(workspacePath);
    this.#setAll(workspaces);
    return workspaces;
  }

  remove(workspacePath) {
    const workspaces = this.getAll();
    const filteredWorkspaces = workspaces.filter((w) => w !== workspacePath);
    this.#setAll(filteredWorkspaces);
    return filteredWorkspaces;
  }
}

module.exports = LastOpenedWorkspaces;
