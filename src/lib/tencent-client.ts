import { z } from "zod";

const tencentResponseSchema = z.object({
  code: z.number(),
  data: z.record(
    z.string(),
    z.object({
      day: z.array(z.array(z.unknown())).optional(),
    }),
  ),
});

function toTencentSymbol(ticker: string) {
  const match = /^(\d{5,6})\.(SH|SZ|HK)$/.exec(ticker.trim().toUpperCase());
  if (!match) throw new Error(`无法识别的 ticker 格式：${ticker}`);
  return `${match[2].toLowerCase()}${match[1]}`;
}

export async function fetchTencentPriceHistory(
  ticker: string,
  startDate: string,
  endDate: string,
) {
  const symbol = toTencentSymbol(ticker);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const param = `${symbol},day,${startDate},${endDate},180`;
    const res = await fetch(
      `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${encodeURIComponent(param)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://gu.qq.com/",
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!res.ok) throw new Error(`腾讯行情返回 HTTP ${res.status}`);

    const parsed = tencentResponseSchema.safeParse(await res.json());
    if (!parsed.success || parsed.data.code !== 0) {
      throw new Error("腾讯历史行情响应格式异常");
    }

    return (parsed.data.data[symbol]?.day ?? [])
      .map((row) => {
        const [date, , close, , , volume] = row;
        if (typeof date !== "string") return null;
        const numericClose = Number(close);
        if (!Number.isFinite(numericClose)) return null;
        return {
          date,
          close: numericClose,
          volume: Number(volume) || 0,
        };
      })
      .filter(
        (point): point is { date: string; close: number; volume: number } =>
          Boolean(point && point.date >= startDate && point.date <= endDate),
      );
  } finally {
    clearTimeout(timeout);
  }
}
