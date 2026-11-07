import { z } from "zod";
export const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  t: z.number().positive().max(8640000000000000),
  alt: z.number().min(-12000).max(20000).nullable().optional(),
  accuracy: z.number().nonnegative().nullable().optional(),
  altAccuracy: z.number().nonnegative().nullable().optional(),
  speed: z.number().nonnegative().nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  breakBefore: z.boolean().optional(),
});
