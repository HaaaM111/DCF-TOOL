import type { NextRequest } from "next/server";
import { z } from "zod";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { getIndustryData, industryDirectory, readIndustrySnapshot } from "@/lib/industry-library";
import { describeIndustrySnapshot, industryNameSchema } from "@/lib/industry-snapshot";

const lookupSchema = z.object({ industry: industryNameSchema, date: z.iso.date().optional(), download: z.literal("1").optional() }).strict();

export async function GET(request: NextRequest) {
  const guard = guardRequest(request);
  if (guard) return guard;
  const query = Object.fromEntries(request.nextUrl.searchParams);
  if (!Object.keys(query).length) return jsonOk({ groups: await industryDirectory() });
  const parsed = lookupSchema.safeParse(query);
  if (!parsed.success) return jsonError("行业或快照日期无效", 422);
  const { industry, date, download } = parsed.data;
  const snapshot = await readIndustrySnapshot(industry, date);
  const view = snapshot ? describeIndustrySnapshot(snapshot) : null;
  const response = jsonOk({ snapshot: view });
  response.headers.set("Cache-Control", "private, no-store");
  if (download && view) response.headers.set("Content-Disposition", `attachment; filename="industry-multiples-${view.date}.json"`);
  return response;
}

export async function POST(request: NextRequest) {
  const guard = guardRequest(request);
  if (guard) return guard;
  const parsed = lookupSchema.pick({ industry: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("行业参数无效", 422);
  const { industry } = parsed.data;
  if (!(await industryDirectory()).some((item) => item.industry === industry)) return jsonError("行业资料组不存在", 404);
  const { snapshot, mode } = await getIndustryData(industry, true);
  return jsonOk({ snapshot: snapshot ? describeIndustrySnapshot(snapshot) : null, mode });
}
