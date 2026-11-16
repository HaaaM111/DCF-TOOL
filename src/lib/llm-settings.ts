import { prisma } from "@/lib/prisma";
import type { LlmConfig } from "@/lib/ai-client";

export const LLM_SETTING_KEYS = {
  baseUrl: "llm_base_url",
  apiKey: "llm_api_key",
  model: "llm_model",
} as const;

export async function readLlmDbSettings(): Promise<Partial<LlmConfig>> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: Object.values(LLM_SETTING_KEYS) } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    baseUrl: map.get(LLM_SETTING_KEYS.baseUrl) || undefined,
    apiKey: map.get(LLM_SETTING_KEYS.apiKey) || undefined,
    model: map.get(LLM_SETTING_KEYS.model) || undefined,
  };
}

export async function writeLlmDbSettings(cfg: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}): Promise<void> {
  const writes: [string, string | undefined][] = [
    [LLM_SETTING_KEYS.baseUrl, cfg.baseUrl?.trim() || undefined],
    [LLM_SETTING_KEYS.apiKey, cfg.apiKey?.trim() || undefined],
    [LLM_SETTING_KEYS.model, cfg.model?.trim() || undefined],
  ];
  for (const [key, value] of writes) {
    if (value) {
      await prisma.appSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    } else {
      await prisma.appSetting.deleteMany({ where: { key } });
    }
  }
}

export function maskKey(key: string | undefined): string {
  if (!key) return "";
  if (key.length <= 10) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export function configSource(db: Partial<LlmConfig> | null): "env" | "db" | "none" {
  if (process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY) return "env";
  if (db?.apiKey) return "db";
  return "none";
}
