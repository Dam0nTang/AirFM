import {
  clearNeteaseSession,
  getNeteaseSessionStatus,
  saveNeteaseSession,
  type NeteaseSessionStatus
} from "./neteaseSession";

export interface NeteaseQrChallenge {
  key: string;
  qrImage: string;
  qrUrl: string;
}

export interface NeteaseQrCheck {
  code: number;
  message?: string;
  loggedIn: boolean;
}

export interface NeteaseAuthService {
  createLoginQr(): Promise<NeteaseQrChallenge>;
  checkLogin(key: string): Promise<NeteaseQrCheck>;
  status(): Promise<NeteaseSessionStatus>;
  importCookie(cookie: string): Promise<NeteaseSessionStatus>;
  logout(): Promise<void>;
}

interface QrKeyResponse {
  code?: number;
  data?: { unikey?: string };
}

interface QrCreateResponse {
  code?: number;
  data?: { qrimg?: string; qrurl?: string };
}

interface QrCheckResponse {
  code?: number;
  message?: string;
  cookie?: string;
}

export function createNeteaseAuthService(baseUrl: string, sessionPath: string): NeteaseAuthService {
  return {
    async createLoginQr() {
      const keyUrl = withTimestamp(new URL("/login/qr/key", baseUrl));
      const keyResponse = await fetchJson<QrKeyResponse>(keyUrl);
      const key = keyResponse.data?.unikey;
      if (!key) {
        throw new Error("Netease QR key was not returned");
      }

      const qrUrl = withTimestamp(new URL("/login/qr/create", baseUrl));
      qrUrl.searchParams.set("key", key);
      qrUrl.searchParams.set("qrimg", "true");
      const qrResponse = await fetchJson<QrCreateResponse>(qrUrl);

      return {
        key,
        qrImage: qrResponse.data?.qrimg ?? "",
        qrUrl: qrResponse.data?.qrurl ?? ""
      };
    },

    async checkLogin(key) {
      const checkUrl = withTimestamp(new URL("/login/qr/check", baseUrl));
      checkUrl.searchParams.set("key", key);
      const check = await fetchJson<QrCheckResponse>(checkUrl);

      if (check.code === 803 && check.cookie) {
        await saveNeteaseSession(sessionPath, check.cookie);
      }

      return {
        code: check.code ?? 0,
        message: check.message,
        loggedIn: check.code === 803
      };
    },

    status: () => getNeteaseSessionStatus(sessionPath),

    async importCookie(cookie) {
      await saveNeteaseSession(sessionPath, cookie);
      return getNeteaseSessionStatus(sessionPath);
    },

    logout: () => clearNeteaseSession(sessionPath)
  };
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Netease auth request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function withTimestamp(url: URL): URL {
  url.searchParams.set("timestamp", String(Date.now()));
  return url;
}
