import type { DevPanelStorage } from '../simulated/devpanel';

const STORE_KEY = 'flaphappy.devpanel';

/** Keeps the demo controls in the window's local storage. Desktop and browser harness only, never the in-sim panel. */
export const localDevPanelStorage: DevPanelStorage = {
  load(): unknown {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch {
      return null;
    }
  },
  save(data: unknown): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      // Storage can be unavailable (private windows); the panel still works unsaved.
    }
  },
};
