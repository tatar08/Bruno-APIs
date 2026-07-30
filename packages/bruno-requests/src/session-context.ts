import { AsyncLocalStorage } from 'async_hooks';

/**
 * Generic async-scoped "current session key" hook, built on AsyncLocalStorage.
 *
 * This package has no concept of what a "session" is (desktop app / CLI runs
 * never set one) — it just exposes a key that a consumer running many logical
 * sessions through one process can attach to the async call chain of a single
 * unit of work (e.g. one HTTP request), and read back further down the stack
 * without threading a parameter through every function signature in between.
 *
 * @usebruno/server uses this to scope IPC dispatch (see its session-context.js)
 * and, transitively, to give each Browser Bridge session its own cookie jar
 * (see ./cookies) instead of sharing one process-wide jar across every user.
 */

const storage = new AsyncLocalStorage<string>();

export function runWithSessionKey<T>(sessionKey: string, fn: () => T): T {
  return storage.run(sessionKey, fn);
}

export function getCurrentSessionKey(): string | undefined {
  return storage.getStore();
}
