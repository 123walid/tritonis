import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };

/** Backend base URL, no trailing slash. Configure via app.json expo.extra.apiUrl. */
export const API_URL: string = extra.apiUrl ?? 'http://localhost:4000';

/** WebSocket endpoint derived from API_URL. */
export const WS_URL: string = API_URL.replace(/^http/, 'ws') + '/ws';
