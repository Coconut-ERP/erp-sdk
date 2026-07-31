export const INIT_DATA_MESSAGE_TYPE = "erp-miniapp:init-data";
export const INIT_DATA_URL_PARAM = "erpInitData";

export interface InitDataUser {
  id: string;
  email: string;
  displayName?: string;
  fullName?: string;
}

/**
 * The decoded fields of an initData string. Unverified — only the backend can
 * check the signature, so treat this as display data and never as authority.
 */
export interface InitDataUnsafe {
  user?: InitDataUser;
  workspaceId?: string;
  serviceAccountId?: string;
  authDate?: number;
  hash?: string;
}

export function parseInitData(initData: string): InitDataUnsafe {
  const params = new URLSearchParams(initData);
  const result: InitDataUnsafe = {};

  const rawUser = params.get("user");
  if (rawUser) {
    try {
      result.user = JSON.parse(rawUser) as InitDataUser;
    } catch {
      result.user = undefined;
    }
  }
  result.workspaceId = params.get("workspace_id") ?? undefined;
  result.serviceAccountId = params.get("service_account_id") ?? undefined;
  const authDate = params.get("auth_date");
  result.authDate = authDate ? Number(authDate) : undefined;
  result.hash = params.get("hash") ?? undefined;
  return result;
}

interface LocationLike {
  hash: string;
  search: string;
}

/**
 * Reads initData embedded in the mini app URL — either
 * `#erpInitData=<encoded>` or `?erpInitData=<encoded>`.
 */
export function readInitDataFromLocation(location?: LocationLike): string | undefined {
  const loc =
    location ??
    (typeof window !== "undefined" ? window.location : undefined);
  if (!loc) return undefined;

  for (const raw of [loc.hash.replace(/^#/, ""), loc.search.replace(/^\?/, "")]) {
    const value = new URLSearchParams(raw).get(INIT_DATA_URL_PARAM);
    if (value) return value;
  }
  return undefined;
}

export interface ReceiveInitDataOptions {
  /** Origins allowed to deliver initData. Required — "*" is refused. */
  allowedOrigins: string[];
  timeoutMs?: number;
}

/**
 * Mini app side of the host bridge: resolves with the initData string when the
 * host posts `{ type: "erp-miniapp:init-data", initData }` via postMessage.
 */
export function receiveInitData(options: ReceiveInitDataOptions): Promise<string> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("receiveInitData requires a browser environment"));
  }
  if (options.allowedOrigins.length === 0 || options.allowedOrigins.includes("*")) {
    return Promise.reject(new Error("receiveInitData requires explicit allowedOrigins"));
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const listener = (event: MessageEvent) => {
      if (!options.allowedOrigins.includes(event.origin)) return;
      const data = event.data as { type?: string; initData?: string } | null;
      if (!data || data.type !== INIT_DATA_MESSAGE_TYPE || !data.initData) return;
      window.removeEventListener("message", listener);
      if (timer) clearTimeout(timer);
      resolve(data.initData);
    };

    window.addEventListener("message", listener);
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        window.removeEventListener("message", listener);
        reject(new Error("Timed out waiting for init data from host"));
      }, options.timeoutMs);
    }
  });
}

interface PostMessageTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

/**
 * Host side of the bridge: delivers initData to an embedded mini app frame.
 * Pass the mini app's exact origin — never "*".
 */
export function sendInitDataToFrame(
  target: PostMessageTarget,
  initData: string,
  targetOrigin: string,
): void {
  if (targetOrigin === "*") {
    throw new Error("sendInitDataToFrame requires an explicit target origin");
  }
  target.postMessage({ type: INIT_DATA_MESSAGE_TYPE, initData }, targetOrigin);
}
