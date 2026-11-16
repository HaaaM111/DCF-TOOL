export interface ParsedAnnouncement {
  category: string;
  worthAnalyzing: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  dataBuffer: Buffer,
) => Promise<{ text?: string }>;

const MAX_PDF_SIZE_KB = 5000;
const MAX_TEXT_CHARS = 6000;
const MIN_TEXT_CHARS = 50;

export async function extractPdfText(
  url: string,
  sizeKb?: number,
): Promise<string | null> {
  if (!url) return null;
  if (sizeKb && sizeKb > MAX_PDF_SIZE_KB) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const data = await pdfParse(buf);
    const text = (data.text ?? "").trim();
    return text.length > MIN_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : null;
  } catch {
    return null;
  }
}

const RULES: { category: string; re: RegExp }[] = [
  { category: "业绩预告", re: /业绩预告|业绩快报|业绩预增|业绩预减|预计(净利|营收|亏损)/ },
  { category: "定期报告", re: /年度报告|半年度报告|季度报告|年报|半年报|季报/ },
  { category: "回购", re: /回购/ },
  { category: "增减持", re: /减持|增持/ },
  { category: "重大合同", re: /重大合同|中标|签订(重大)?合同|战略合作/ },
  { category: "股权激励", re: /股权激励|限制性股票|股票期权/ },
  { category: "分红", re: /分红|利润分配|权益分派/ },
  { category: "风险", re: /立案|调查|处罚|退市|风险提示|违规/ },
];

export function classify(title: string): ParsedAnnouncement {
  for (const r of RULES) {
    if (r.re.test(title)) return { category: r.category, worthAnalyzing: true };
  }
  return { category: "其他", worthAnalyzing: false };
}
