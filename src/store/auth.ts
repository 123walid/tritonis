import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { login as apiLogin, logout as apiLogout } from '../api/client';
import { registerAuthBridge } from '../api/auth-bridge';

const TOKEN_KEY = 'tritonis.token';
const USER_KEY = 'tritonis.user';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthState {
  status: 'restoring' | 'signedOut' | 'signedIn';
  token: string | null;
  user: AuthUser | null;
  /** Restore persisted session (SecureStore token + AsyncStorage user). */
  restore(): Promise<void>;
  /** Authenticate against the backend; throws ApiError on failure. */
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Immediate local logout (e.g. on 401 from API/WS). Never throws. */
  forceLogout(): void;
}

// SecureStore is unavailable on some platforms (e.g. web); fall back to AsyncStorage.
async function saveToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  }
}

async function loadToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return AsyncStorage.getItem(TOKEN_KEY);
  }
}

async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
}

export const useAuthStore: UseBoundStore<StoreApi<AuthState>> = create<AuthState>((set) => ({
  status: 'restoring',
  token: null,
  user: null,

  async restore() {
    try {
      const [token, userJson] = await Promise.all([loadToken(), AsyncStorage.getItem(USER_KEY)]);
      if (token) {
        let user: AuthUser | null = null;
        if (userJson) {
          try {
            user = JSON.parse(userJson) as AuthUser;
          } catch {
            user = null;
          }
        }
        set({ status: 'signedIn', token, user });
      } else {
        set({ status: 'signedOut', token: null, user: null });
      }
    } catch {
      set({ status: 'signedOut', token: null, user: null });
    }
  },

  async signIn(email: string, password: string) {
    const res = await apiLogin(email, password); // throws ApiError
    await saveToken(res.token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.user)).catch(() => undefined);
    set({ status: 'signedIn', token: res.token, user: res.user });
  },

  async signOut() {
    await apiLogout(); // best-effort, never throws
    await clearToken();
    await AsyncStorage.removeItem(USER_KEY).catch(() => undefined);
    set({ status: 'signedOut', token: null, user: null });
  },

  forceLogout() {
    void clearToken();
    void AsyncStorage.removeItem(USER_KEY).catch(() => undefined);
    set({ status: 'signedOut', token: null, user: null });
  },
}));

// Register with the API client (breaks the client.ts ↔ auth.ts require cycle).
registerAuthBridge(
  () => useAuthStore.getState().token,
  () => useAuthStore.getState().forceLogout(),
);
