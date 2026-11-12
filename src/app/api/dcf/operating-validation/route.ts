import type { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { analyzeOperatingValuation, operatingAnalysisSchema } from "@/lib/operating-scenarios";

export async function POST(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  const parsed = operatingAnalysisSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 6).map(({ path, message }) =>
      path.length ? `${path.join(".")} ${message}` : message);
    return jsonError(issues.join("；"), 422, "VALIDATION_ERROR");
  }

  return jsonOk(analyzeOperatingValuation(parsed.data));
}
