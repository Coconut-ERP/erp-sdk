const URL_PARAM = "erpInitData";
const INIT_DATA_MESSAGE = "erp-miniapp:init-data";
const REQUEST_MESSAGE = "erp-miniapp:request-init-data";

/**
 * The app is served under `/apps/<slug>-<id>/` behind the ERP proxy, which
 * strips that prefix before the request reaches us. Building URLs from the
 * current pathname keeps every call inside the app, with or without the
 * trailing slash the host normally adds.
 */
export function appUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const base = window.location.pathname.endsWith("/")
    ? window.location.pathname
    : `${window.location.pathname}/`;
  return `${base}${path.replace(/^\//, "")}`;
}

/** Reads the signed string the host put in the URL when it opened the frame. */
export function readInitDataFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  for (const raw of [window.location.hash.slice(1), window.location.search.slice(1)]) {
    const value = new URLSearchParams(raw).get(URL_PARAM);
    if (value) return value;
  }
  return null;
}

/**
 * Asks the host app for a fresh initData and waits for its postMessage reply.
 * Any origin may answer: the string is only a claim until the backend trades it
 * for a session, and one the ERP did not sign dies there. That keeps a single
 * build working in every workspace with no origin list to configure.
 */
export function requestInitData(timeoutMs = 10_000): Promise<string> {
  if (window.parent === window) {
    return Promise.reject(
      new Error("App đang chạy ngoài ERP nên không có initData — hãy mở app từ trong ERP"),
    );
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Không nhận được initData từ ERP"));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; initData?: string } | null;
      if (data?.type !== INIT_DATA_MESSAGE || !data.initData) return;

      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data.initData);
    }

    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: REQUEST_MESSAGE }, "*");
  });
}
