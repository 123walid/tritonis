/**
 * Bridge between the API client and the auth store.
 *
 * client.ts needs the current token + a way to force logout on 401,
 * while auth.ts needs login/logout from client.ts — a require cycle.
 * This tiny module breaks the cycle: it imports nothing from either side.
 * The auth store registers itself here at module load.
 */

let tokenGetter: () => string | null = () => null;
let unauthorizedHandler: () => void = () => undefined;

/** Called once by the auth store module. */
export function registerAuthBridge(getToken: () => string | null, onUnauthorized: () => void): void {
  tokenGetter = getToken;
  unauthorizedHandler = onUnauthorized;
}

export function getAuthToken(): string | null {
  return tokenGetter();
}

export function handleUnauthorized(): void {
  unauthorizedHandler();
}
