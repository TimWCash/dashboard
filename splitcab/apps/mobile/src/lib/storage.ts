import * as SecureStore from 'expo-secure-store';

// The refresh token lives in the iOS Keychain / Android Keystore.
export const secureStorage = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
