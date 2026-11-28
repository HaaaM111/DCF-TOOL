/**
 * 行情历史去重脚本
 * ------------------------------------------------------------
 * 旧版同步把同一交易日写成了多条快照（2522 行只对应 366 个自然日），
 * 走势图因此出现同日多点抖动。这里按 (ticker, 自然日) 只保留当天最新一条，
 * 并把保留行的 date 规整到 UTC 零点，和 saveHistory 的新口径一致。
 *
 *   tsx scripts/dedupe-price-snapshots.ts           # 干跑
 *   tsx scripts/dedupe-price-snapshots.ts --apply
 */
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");
const log = (...a: unknown[]) => console.log(APPLY ? "[apply]" : "[dry-run]", ...a);

async function main() {
  const tickers = await prisma.priceSnapshot.findMany({
    select: { ticker: true },
    distinct: ["ticker"],
  });

  let removed = 0;
  let normalized = 0;

  for (const { ticker } of tickers) {
    const rows = await prisma.priceSnapshot.findMany({
      where: { ticker },
      orderBy: { date: "asc" },
    });

    const keep = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const day = row.date.toISOString().slice(0, 10);
      const prev = keep.get(day);
      if (!prev || row.date.getTime() >= prev.date.getTime()) keep.set(day, row);
    }

    const keepIds = new Set([...keep.values()].map((r) => r.id));
    const extraIds = rows.filter((r) => !keepIds.has(r.id)).map((r) => r.id);

    log(`${ticker}: ${rows.length} 行 → ${keep.size} 天（删除 ${extraIds.length} 行）`);
    removed += extraIds.length;

    if (!APPLY) continue;

    if (extraIds.length) {
      await prisma.priceSnapshot.deleteMany({ where: { id: { in: extraIds } } });
    }

    for (const [day, row] of keep) {
      const target = new Date(`${day}T00:00:00.000Z`);
      if (row.date.getTime() === target.getTime()) continue;
      normalized += 1;
      await prisma.priceSnapshot.update({
        where: { id: row.id },
        data: { date: target },
      });
    }
  }

  log(`完成：删除 ${removed} 行，规整日期 ${normalized} 行`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
