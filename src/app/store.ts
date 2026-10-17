/*
 * A small external store.
 *
 * The editor keeps one state object here. Components subscribe to the slices
 * they read through useEditor, so a hover change doesn't re-render the panels
 * and a style edit doesn't re-render the toolbar.
 */

import { useSyncExternalStore } from 'react';

export interface Store<S> {
  get(): S;
  set(update: Partial<S> | ((state: S) => Partial<S>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      const patch = typeof update === 'function' ? update(state) : update;
      if (Object.keys(patch).every((key) => (state as Record<string, unknown>)[key] === (patch as Record<string, unknown>)[key])) return;
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribes to one slice of a store. The selector must return stable references for unchanged data. */
export function useStoreSlice<S, T>(store: Store<S>, selector: (state: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

/** Remembers the last result of `make` for the same arguments, compared by identity. */
export function memoLast<A extends unknown[], R>(make: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | undefined;
  let lastResult: R;
  return (...args: A) => {
    if (!lastArgs || args.length !== lastArgs.length || args.some((arg, i) => arg !== lastArgs![i])) {
      lastArgs = args;
      lastResult = make(...args);
    }
    return lastResult;
  };
}
