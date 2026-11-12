import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().default("AdCoDe"),
  APP_URL: z.string().default("http://localhost:4173"),
  API_PORT: z.coerce.number().default(4100),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGINS: z.string().optional(),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@postgres-local:5432/adcode?schema=public"),

  JWT_ACCESS_SECRET: z.string().default("change-me-access-secret"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().default("change-me-refresh-secret"),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  PLATFORM_ADMIN_EMAIL: z.string().email().default("admin@supernovatel.com"),
  PLATFORM_ADMIN_NAME: z.string().default("Platform Admin"),

  S3_ENDPOINT: z.string().optional(),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("adcode"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional(),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().default(300),
  UPLOAD_MAX_MB: z.coerce.number().default(10),
  UPLOAD_ALLOWED_MIME: z.string().default("image/jpeg,image/png,image/webp,application/pdf"),

  RESERVATION_HOLD_MINUTES: z.coerce.number().default(15),
  DEFAULT_TIMEZONE: z.string().default("America/La_Paz"),
  DEFAULT_CURRENCY: z.string().default("BOB"),
  DEFAULT_LOCALE: z.string().default("es-BO"),
  DEFAULT_NIGHT_START: z.string().default("18:00"),
  MODULE_EXPIRY_WARN_DAYS: z.coerce.number().default(7),

  DEV_LOGIN_ENABLED: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const isProd = env.NODE_ENV === "production";
export const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : isProd;
export const uploadsEnabled = Boolean(env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY);
export const googleAuthEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
export const devLoginEnabled = env.DEV_LOGIN_ENABLED ? env.DEV_LOGIN_ENABLED === "true" : !isProd;