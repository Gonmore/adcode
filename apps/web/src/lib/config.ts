export type RuntimeConfig = {
  apiBaseUrl: string;
  appName: string;
  vapidPublicKey: string;
};

export function getRuntimeConfig(): RuntimeConfig {
  const cfg = window.__APP_CONFIG__ || {};
  return {
    apiBaseUrl: cfg.API_BASE_URL || "/api/v1",
    appName: cfg.APP_NAME || "AdCoDe",
    vapidPublicKey: cfg.VAPID_PUBLIC_KEY || "",
  };
}
