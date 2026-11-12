export const ROLES = [
  "PLATFORM_ADMIN",
  "TENANT_ADMIN",
  "COMPLEX_ADMIN",
  "SELLER",
  "CLIENT",
] as const;
export type Role = (typeof ROLES)[number];

export const CLIENT_TIERS = ["NORMAL", "HABITUAL", "PREFERENCIAL"] as const;
export type ClientTier = (typeof CLIENT_TIERS)[number];

export const MODULES = ["AUTH", "USERS", "SCENARIOS", "SALES", "INVENTORY", "REPORTS"] as const;
export type AppModule = (typeof MODULES)[number];

export const RESERVATION_STATUSES = [
  "PENDING_PAYMENT",
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
  "REJECTED",
  "NO_SHOW",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const PAYMENT_METHODS = ["CASH", "TRANSFER", "QR", "SHARED_QR", "CREDIT"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["PENDING", "CONFIRMED", "REJECTED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const RENTAL_FORMATS = ["PER_HOUR", "PER_PERSON", "MIXED", "FLAT_BLOCK"] as const;
export type RentalFormat = (typeof RENTAL_FORMATS)[number];
