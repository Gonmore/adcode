export type RuntimeConfig = {
  apiBaseUrl: string;
  appName: string;
  vapidPublicKey: string;
};

declare global {
  interface Window {
    __APP_CONFIG__?: {
      API_BASE_URL?: string;
      APP_NAME?: string;
      VAPID_PUBLIC_KEY?: string;
    };
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  const cfg = (typeof window !== "undefined" ? window.__APP_CONFIG__ : undefined) || {};
  return {
    apiBaseUrl: cfg.API_BASE_URL || "/api/v1",
    appName: cfg.APP_NAME || "AdCoDe",
    vapidPublicKey: cfg.VAPID_PUBLIC_KEY || "",
  };
}
