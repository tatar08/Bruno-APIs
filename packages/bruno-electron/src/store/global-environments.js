const _ = require('lodash');
const Store = require('electron-store');
const { parseValueByDataType, valueToString } = require('@usebruno/common/utils');
const { encryptStringSafe, decryptStringSafe } = require('../utils/encryption');
const { environmentSchema } = require('@usebruno/schema');
const { posixifyPath } = require('../utils/filesystem');
const { getCurrentSessionKey } = require('@usebruno/requests');

class GlobalEnvironmentsStore {
  constructor() {
    this.store = new Store({
      name: 'global-environments',
      clearInvalidConfig: true
    });
  }

  /**
   * Validates and filters environments array, removing invalid entries
   * @param {Array} environments - Array of environment objects to validate
   * @returns {Array} - Array of valid environments
   */
  filterValidEnvironments(environments) {
    if (!Array.isArray(environments)) {
      return [];
    }

    return environments.filter((env) => {
      try {
        environmentSchema.validateSync(env);
        return true;
      } catch (error) {
        console.error('Invalid environment:', env);
        console.error(error);
        return false;
      }
    });
  }

  encryptGlobalEnvironmentVariables({ globalEnvironments }) {
    return globalEnvironments?.map((env) => {
      const variables = env.variables?.map((v) => ({
        ...v,
        value: v?.secret ? encryptStringSafe(valueToString(v.value)).value : v?.value
      })) || [];

      return {
        ...env,
        variables
      };
    });
  }

  decryptGlobalEnvironmentVariables({ globalEnvironments }) {
    return globalEnvironments?.map((env) => {
      const variables = env.variables?.map((v) => ({
        ...v,
        value: v?.secret ? parseValueByDataType(decryptStringSafe(v.value).value, v.dataType) : v?.value
      })) || [];

      return {
        ...env,
        variables
      };
    });
  }

  getGlobalEnvironments() {
    let globalEnvironments = this.store.get('environments', []);

    // Previously, a bug caused environment variables to be saved without a type.
    // Since that issue is now fixed, this code ensures that anyone who imported
    // data before the fix will have the missing types added retroactively.
    globalEnvironments?.forEach((env) => {
      env?.variables?.forEach((v) => {
        if (!v.type) {
          v.type = 'text';
        }
        if (v.dataType && v.dataType !== 'string' && !v.secret) {
          v.value = parseValueByDataType(v.value, v.dataType);
        }
      });
    });

    globalEnvironments = this.filterValidEnvironments(globalEnvironments);

    globalEnvironments = this.decryptGlobalEnvironmentVariables({ globalEnvironments });

    return globalEnvironments;
  }

  // This is the fallback used when no workspace is active yet (e.g. before a
  // Browser Bridge session has opened/selected one) -- see
  // getActiveGlobalEnvironmentUidForWorkspace for the (already session-safe,
  // since it's keyed by workspace) modern path. Without session scoping here,
  // two concurrent Browser Bridge sessions with no active workspace would
  // share and overwrite the same single active-environment selection
  // (Improvement.md P0.4). In desktop/no-auth mode getCurrentSessionKey() is
  // always undefined, so this collapses back to the original single
  // electron-store field -- unchanged behavior for that case.
  getActiveGlobalEnvironmentUid() {
    const sessionKey = getCurrentSessionKey();
    if (!sessionKey) {
      return this.store.get('activeGlobalEnvironmentUid', null);
    }
    const mapping = this.store.get('activeGlobalEnvironmentUidBySession', {});
    return sessionKey in mapping ? mapping[sessionKey] : null;
  }

  setActiveGlobalEnvironmentUid(uid) {
    const sessionKey = getCurrentSessionKey();
    if (!sessionKey) {
      return this.store.set('activeGlobalEnvironmentUid', uid);
    }
    const mapping = this.store.get('activeGlobalEnvironmentUidBySession', {});
    mapping[sessionKey] = uid || null;
    this.store.set('activeGlobalEnvironmentUidBySession', mapping);
  }

  getActiveGlobalEnvironmentUidForWorkspace(workspacePath) {
    if (!workspacePath) return undefined;
    const key = posixifyPath(workspacePath);
    const mapping = this.store.get('activeGlobalEnvironmentUidByWorkspace', {});
    if (key in mapping) {
      return mapping[key];
    }
    return undefined;
  }

  setActiveGlobalEnvironmentUidForWorkspace(workspacePath, uid) {
    if (!workspacePath) return;
    const key = posixifyPath(workspacePath);
    const mapping = this.store.get('activeGlobalEnvironmentUidByWorkspace', {});
    mapping[key] = uid || null;
    this.store.set('activeGlobalEnvironmentUidByWorkspace', mapping);
  }

  removeActiveGlobalEnvironmentUidForWorkspace(workspacePath) {
    if (!workspacePath) return;
    const key = posixifyPath(workspacePath);
    const mapping = this.store.get('activeGlobalEnvironmentUidByWorkspace', {});
    delete mapping[key];
    this.store.set('activeGlobalEnvironmentUidByWorkspace', mapping);
  }

  setGlobalEnvironments(globalEnvironments) {
    globalEnvironments = this.filterValidEnvironments(globalEnvironments);

    globalEnvironments = this.encryptGlobalEnvironmentVariables({ globalEnvironments });
    return this.store.set('environments', globalEnvironments);
  }

  addGlobalEnvironment({ uid, name, variables = [], color }) {
    let globalEnvironments = this.getGlobalEnvironments();
    const existingEnvironment = globalEnvironments.find((env) => env?.name == name);
    if (existingEnvironment) {
      throw new Error('Environment with the same name already exists');
    }
    globalEnvironments.push({
      uid,
      name,
      variables,
      color
    });
    this.setGlobalEnvironments(globalEnvironments);
  }

  saveGlobalEnvironment({ environmentUid: globalEnvironmentUid, variables, color }) {
    let globalEnvironments = this.getGlobalEnvironments();
    const environment = globalEnvironments.find((env) => env?.uid == globalEnvironmentUid);
    globalEnvironments = globalEnvironments.filter((env) => env?.uid !== globalEnvironmentUid);
    if (environment) {
      environment.variables = variables;
      if (color !== undefined) {
        environment.color = color;
      }
    }
    globalEnvironments.push(environment);
    this.setGlobalEnvironments(globalEnvironments);
  }

  renameGlobalEnvironment({ environmentUid: globalEnvironmentUid, name }) {
    let globalEnvironments = this.getGlobalEnvironments();
    const environment = globalEnvironments.find((env) => env?.uid == globalEnvironmentUid);
    globalEnvironments = globalEnvironments.filter((env) => env?.uid !== globalEnvironmentUid);
    if (environment) {
      environment.name = name;
    }
    globalEnvironments.push(environment);
    this.setGlobalEnvironments(globalEnvironments);
  }

  copyGlobalEnvironment({ uid, name, variables }) {
    let globalEnvironments = this.getGlobalEnvironments();
    globalEnvironments.push({
      uid,
      name,
      variables
    });
    this.setGlobalEnvironments(globalEnvironments);
  }

  selectGlobalEnvironment({ environmentUid: globalEnvironmentUid }) {
    let globalEnvironments = this.getGlobalEnvironments();
    const environment = globalEnvironments.find((env) => env?.uid == globalEnvironmentUid);
    if (environment) {
      this.setActiveGlobalEnvironmentUid(globalEnvironmentUid);
    } else {
      this.setActiveGlobalEnvironmentUid(null);
    }
  }

  deleteGlobalEnvironment({ environmentUid }) {
    let globalEnvironments = this.getGlobalEnvironments();
    let activeGlobalEnvironmentUid = this.getActiveGlobalEnvironmentUid();
    globalEnvironments = globalEnvironments.filter((env) => env?.uid !== environmentUid);
    if (environmentUid == activeGlobalEnvironmentUid) {
      this.setActiveGlobalEnvironmentUid(null);
    }
    this.setGlobalEnvironments(globalEnvironments);
  }

  updateGlobalEnvironmentColor({ environmentUid, color }) {
    let globalEnvironments = this.getGlobalEnvironments();
    const environment = globalEnvironments.find((env) => env?.uid == environmentUid);
    if (environment) {
      environment.color = color;
    }
    this.setGlobalEnvironments(globalEnvironments);
  }
}

const globalEnvironmentsStore = new GlobalEnvironmentsStore();

module.exports = {
  globalEnvironmentsStore
};
