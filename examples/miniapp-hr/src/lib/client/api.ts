import { appUrl, readInitDataFromLocation, requestInitData } from "./init-data";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let initData: string | null = null;
let acquiring: Promise<string | null> | null = null;
let bridgeError: string | null = null;

async function acquireInitData(forceRefresh: boolean): Promise<string> {
  if (!forceRefresh) {
    const fromLocation = readInitDataFromLocation();
    if (fromLocation) return fromLocation;
  }
  return requestInitData();
}

/**
 * One acquisition at a time, shared by every request that needs it. Failing to
 * get an initData is not fatal here: the request goes out without the header
 * and the server answers 401, which the UI turns into the reason the bridge
 * failed.
 */
function ensureInitData(forceRefresh = false): Promise<string | null> {
  if (initData && !forceRefresh) return Promise.resolve(initData);

  acquiring ??= acquireInitData(forceRefresh)
    .then((value) => {
      initData = value;
      bridgeError = null;
      return value;
    })
    .catch((error: unknown) => {
      bridgeError = error instanceof Error ? error.message : String(error);
      return null;
    })
    .finally(() => {
      acquiring = null;
    });
  return acquiring;
}

function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
  return fetch(appUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Init-Data": token } : {}),
      ...init.headers,
    },
  });
}

/**
 * Calls the app's own backend with the verified identity attached. A 401 means
 * the five-minute initData expired, so we ask the host for a new one and retry
 * once — the Telegram-style re-launch flow.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await send(path, init, await ensureInitData());

  if (response.status === 401) {
    const refreshed = await ensureInitData(true);
    if (refreshed) response = await send(path, init, refreshed);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    const message =
      response.status === 401 && bridgeError ? bridgeError : (body?.error ?? response.statusText);
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

export const apiJson = <T>(path: string, method: string, body: unknown): Promise<T> =>
  api<T>(path, { method, body: JSON.stringify(body) });
