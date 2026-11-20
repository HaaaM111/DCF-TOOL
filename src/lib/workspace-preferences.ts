import { z } from "zod";

export const preferencesSchema = z.strictObject({
  boardDensity: z.enum(["compact", "comfortable"]),
  boardPageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]),
  autoRefreshNews: z.boolean(),
});

export type WorkspacePreferences = z.infer<typeof preferencesSchema>;
export const workspaceDefaults: WorkspacePreferences = { boardDensity: "compact", boardPageSize: 20, autoRefreshNews: true };
export const workspaceStorageKey = "valueinsight-workspace-preferences-v1";
