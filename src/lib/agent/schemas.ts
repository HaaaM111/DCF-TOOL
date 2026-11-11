import { z } from "zod";
export const idSchema=z.string().trim().min(1).max(100).regex(/^[\w-]+$/);
export const chatSchema=z.object({companyId:idSchema,messages:z.array(z.object({role:z.enum(["user","assistant"]),content:z.string().trim().min(1).max(4000)})).min(1).max(20),maxSteps:z.number().int().min(1).max(10).optional()}).strict();
export const configSchema=z.object({baseUrl:z.string().trim().max(500).optional(),apiKey:z.string().trim().max(512).optional(),model:z.string().trim().max(100).optional(),thinking:z.enum(["disabled","auto","enabled"]).optional()}).strict();
export const analystSchema=z.object({role:z.literal("assumption_analyst"),reviews:z.array(z.object({field:z.enum(["g1","g2","g3","perpetualG","ke","exitPe"]),assessment:z.enum(["保留","需校准","证据不足"]),reason:z.string().max(500)})).max(6),limitations:z.array(z.string().max(500)).max(5)});
export type AnalystHandoff=z.infer<typeof analystSchema>;
