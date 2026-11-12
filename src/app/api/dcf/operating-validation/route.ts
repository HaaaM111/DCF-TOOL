import type { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { analyzeOperatingModel, operatingModelInputSchema } from "@/lib/operating-model-input";

export async function POST(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  const parsed = operatingModelInputSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 6).map(({ path, message }) =>
      path.length ? `${path.join(".")} ${message}` : message);
    return jsonError(issues.join("；"), 422, "VALIDATION_ERROR");
  }

  return jsonOk(analyzeOperatingModel(parsed.data));
}
