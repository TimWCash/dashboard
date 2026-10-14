// The web build is only used for development and testing; there's no keychain, so use localStorage.
export const secureStorage = {
  get: async (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: async (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable; the session lasts until the tab closes.
    }
  },
  remove: async (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to remove.
    }
  },
};
