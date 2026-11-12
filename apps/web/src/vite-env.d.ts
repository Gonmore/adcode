/// <reference types="vite/client" />

interface AppConfig {
  API_BASE_URL?: string;
  APP_NAME?: string;
  VAPID_PUBLIC_KEY?: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: AppConfig;
  }
}
