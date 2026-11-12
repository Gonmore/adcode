import { z } from "zod";

export const tenantSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  contactName: z.string().min(2),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
  maxComplexes: z.number().int().positive().default(1),
});

export const complexSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  timezone: z.string().min(3),
  currency: z.string().min(3).max(3),
  nightStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  nightEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export const reservationCreateSchema = z.object({
  scenarioId: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  people: z.number().int().positive().optional(),
  items: z.array(z.object({ productId: z.string(), qty: z.number().int().positive() })).optional(),
  isVip: z.boolean().optional(),
});

export type TenantInput = z.infer<typeof tenantSchema>;
export type ComplexInput = z.infer<typeof complexSchema>;
export type ReservationCreateInput = z.infer<typeof reservationCreateSchema>;
