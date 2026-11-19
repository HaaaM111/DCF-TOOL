/**
 * 东方财富公开接口客户端（免费数据源，无 token）
 * ------------------------------------------------------------------
 * 设计目的：作为 iFinD 的分流/兜底数据源（EASTMONEY_ENABLED !== "false" 时启用）。
 *   - 实时行情、历史 K 线：高频调用，直接走本客户端，省 iFinD token 额度
 *   - 财务数据：iFinD 失败时的二级兜底（仅 A 股；港股 F10 接口不支持，会明确抛错）
 *
 * 已验证接口（2026-10 实测）：
 *   实时行情   GET https://push2.eastmoney.com/api/qt/stock/get?secid=1.600104&fields=f43,f47,f57,f58,f60,f116,f117
 *   历史日K    GET https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600104&klt=101&fqt=0&beg=...&end=... （不复权，对齐 iFinD）
 *   主要财务指标 GET https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&filter=(SECURITY_CODE="600104")(REPORT_DATE='2025-12-31')
 *   资产负债表 GET https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZcfzbAjaxNew?companyType=4&reportDateType=0&reportType=1&dates=2025-12-31&code=SH600104
 *   现金流量表 GET https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/XjllbAjaxNew?companyType=4&reportDateType=0&reportType=1&dates=2025-12-31&code=SH600104
 *
 * 精度规则（实测确认）：
 *   - 实时行情价格类字段（f43 最新价 / f60 昨收 / f169 涨跌额）：A 股(沪深) ÷100，港股 ÷1000
 *   - 市值类字段（f116 总市值 / f117 流通市值）：直接为元，无需换算
 *   - 成交量 f47：单位"手"
 *   - 历史 K 线 klines 字符串为真实价格（元），无需换算；成交量单位"手"
 *   - 财务主表字段均为元/股原始单位，与 iFinD 一致
 *
 * 单位约定（与 ifind-client 保持一致）：对外输出统一换算为 亿元 / 亿股。
 */

import { z } from "zod";

// ============================================================
// 配置与常量
// ============================================================

const PUSH2_BASE = "https://push2.eastmoney.com";
const PUSH2HIS_BASE = "https://push2his.eastmoney.com";
const DATACENTER_BASE = "https://datacenter-web.eastmoney.com";
const EMWEB_BASE = "https://emweb.securities.eastmoney.com";
const SEARCH_BASE = "https://searchapi.eastmoney.com";

/** 东财搜索建议接口的前端公开 token（官方网页固定值，非敏感凭据） */
const SEARCH_TOKEN = "D43BF722C8E33BDC906FB84D85E326E8";

/** 行情接口备用主机（push2delay 为东财延迟行情镜像，结构一致，用于 failover） */
const PUSH2_HOSTS = [PUSH2_BASE, "https://push2delay.eastmoney.com"];

/** 单次 HTTP 请求超时 */
const REQUEST_TIMEOUT_MS = 15000;
/** 每个主机的失败重试次数 */
const MAX_RETRIES = 3;
/** 重试间隔（ms） */
const RETRY_BASE_DELAY_MS = 600;

/** 是否启用东财数据源（默认启用；显式设置 EASTMONEY_ENABLED=false 可关闭） */
export function isEastMoneyEnabled(): boolean {
  return process.env.EASTMONEY_ENABLED !== "false";
}

// ============================================================
// 标的代码转换
// ============================================================

/** 将 iFinD 格式 ticker（600104.SH / 000001.SZ / 00700.HK）转为东财 secid */
export function toSecid(ticker: string): string {
  const m = /^(\d{5,6})\.(SH|SZ|HK)$/.exec(ticker.trim().toUpperCase());
  if (!m) throw new Error(`无法识别的 ticker 格式：${ticker}`);
  const code = m[1];
  const market = m[2];
  if (market === "SH") return `1.${code}`;
  if (market === "SZ") return `0.${code}`;
  if (market === "HK") return `116.${code}`;
  throw new Error(`暂不支持的交易所：${market}`);
}

/** 东财 F10（emweb）用的 code 参数：600104.SH → SH600104 */
function toEmCode(ticker: string): string {
  const m = /^(\d{5,6})\.(SH|SZ)$/.exec(ticker.trim().toUpperCase());
  if (!m) throw new Error(`东财财务兜底仅支持 A 股：${ticker}`);
  return `${m[2]}${m[1]}`;
}

/** 实时行情价格类字段的缩放：A股 ÷100，港股 ÷1000 */
function priceScale(ticker: string): number {
  return ticker.trim().toUpperCase().endsWith(".HK") ? 1000 : 100;
}

// ============================================================
// 通用请求封装（带重试）
// ============================================================

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  const msg = err.message;
  if (msg.includes("超时") || msg.includes("fetch failed")) return true;
  const code = (err as NodeJS.ErrnoException).code;
  if (code) {
    const retryable = [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EHOSTUNREACH",
      "ENOTFOUND",
      "EPIPE",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "UND_ERR_RESPONSE_STATUS_CODE",
    ];
    if (retryable.includes(code)) return true;
  }
  return false;
}

/** GET 请求 + 超时 + 重试，返回解析后的 JSON */
async function eastGet<T>(url: string, label: string): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "https://quote.eastmoney.com/",
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`东财请求失败 [${label}]: HTTP ${res.status}`);
        }
        return (await res.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_RETRIES || !isRetryable(err)) break;
      await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
    }
  }

  if (lastErr instanceof Error && lastErr.name === "AbortError") {
    throw new Error(`东财请求超时 [${label}]，已重试 ${MAX_RETRIES} 次`);
  }
  if (lastErr instanceof Error) {
    throw new Error(`东财请求失败 [${label}]：${lastErr.message}`);
  }
  throw new Error(`东财请求失败 [${label}]`);
}

/**
 * 多主机 failover 请求：逐个主机调用 eastGet（每个主机内部自带重试），
 * 应对 push2 等公开接口偶发的连接拒绝/抖动
 */
async function eastGetWithFailover<T>(
  hosts: string[],
  path: string,
  label: string,
): Promise<T> {
  const errors: string[] = [];
  for (const host of hosts) {
    try {
      return await eastGet<T>(host + path, label);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  throw new Error(`东财请求失败 [${label}]：${errors.join("；")}`);
}

// ============================================================
// 实时行情（push2）
// ============================================================

const quoteSchema = z.object({
  rc: z.number(),
  data: z
    .object({
      f43: z.number().nullable(), // 最新价（分/千分位）
      f47: z.number().nullable(), // 成交量（手）
      f57: z.string().nullable().optional(), // 证券代码
      f58: z.string().nullable().optional(), // 证券简称
      f60: z.number().nullable(), // 昨收
      f116: z.number().nullable(), // 总市值（元）
      f117: z.number().nullable(), // 流通市值（元）
    })
    .nullable(),
});

/** 获取最新行情（收盘价/成交量），东财实时接口 */
export async function fetchEastQuote(ticker: string) {
  const secid = toSecid(ticker);
  const url =
    `/api/qt/stock/get?secid=${secid}` +
    "&fields=f43,f47,f57,f58,f60,f116,f117";
  const raw = await eastGetWithFailover<unknown>(
    PUSH2_HOSTS,
    url,
    `quote ${ticker}`,
  );
  const parsed = quoteSchema.safeParse(raw);

  if (!parsed.success || !parsed.data.data) {
    throw new Error(`东财行情响应异常 [${ticker}]（接口可能已变更）`);
  }
  const d = parsed.data.data;
  if (d.f43 === null || d.f43 === undefined) {
    throw new Error(`东财无法获取 ${ticker} 的最新价`);
  }

  const scale = priceScale(ticker);
  const close = d.f43 / scale;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  return {
    ticker,
    close: Number(close.toFixed(2)),
    volume: d.f47 ?? 0,
    date: today,
    name: d.f58 ?? "",
    // 总市值（元）/ 最新价（元） = 总股本（股）；单位统一为 亿股
    shares: d.f116
      ? Number(((d.f116 / close) / 1e8).toFixed(2))
      : 0,
    marketCap: d.f116 ? Number((d.f116 / 1e8).toFixed(2)) : 0,
  };
}

// ============================================================
// 历史日 K（push2his）
// ============================================================

const klineSchema = z.object({
  rc: z.number(),
  data: z
    .object({
      klines: z.array(z.string()).optional(),
    })
    .nullable(),
});

/**
 * 获取历史日 K（不复权，fqt=0，与 iFinD 一致）
 * klines 每项格式：日期,开盘,收盘,最高,最低,成交量(手),成交额(元),振幅%
 */
export async function fetchEastPriceHistory(
  ticker: string,
  startDate: string,
  endDate: string,
) {
  const secid = toSecid(ticker);
  const beg = startDate.replace(/-/g, "");
  const end = endDate.replace(/-/g, "");
  const url =
    `/api/qt/stock/kline/get?secid=${secid}` +
    "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58" +
    `&klt=101&fqt=0&beg=${beg}&end=${end}`;

  const raw = await eastGetWithFailover<unknown>(
    [PUSH2HIS_BASE],
    url,
    `history ${ticker}`,
  );
  const parsed = klineSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.data?.klines) {
    throw new Error(`东财历史行情响应异常 [${ticker}]（接口可能已变更）`);
  }

  return parsed.data.data.klines.map((line) => {
    const [date, , close, , , volume] = line.split(",");
    return {
      date: date.slice(0, 10),
      close: Number(close),
      volume: Number(volume) || 0,
    };
  });
}

// ============================================================
// 股票搜索（searchapi suggest，全市场 A/港股，免费）
// ============================================================

export interface StockSuggestion {
  ticker: string; // iFinD 格式：600519.SH / 00700.HK
  name: string;
  market: "SH" | "SZ" | "HK";
}

/** 东财搜索建议单条（仅取用到的字段） */
interface SuggestRow {
  Code?: string | number;
  Name?: string;
  Classify?: string;
  QuoteID?: string;
}

// 搜索缓存：同一关键词 5 分钟内直接返回，避免输入时反复打东财接口
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 200;
const searchCache = new Map<
  string,
  { data: StockSuggestion[]; expiresAt: number }
>();

/**
 * 全市场搜索建议（支持中文名/拼音/代码），返回 A 股 + 港股。
 * 过滤掉指数/板块/债券/美股/权证等非 DCF 标的。
 * GET https://searchapi.eastmoney.com/api/suggest/get?input=...&type=14
 */
export async function searchEastSuggest(
  keyword: string,
): Promise<StockSuggestion[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  const key = kw.toLowerCase();

  // 缓存命中直接返回（含空结果，避免无效词反复请求）
  const hit = searchCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const url =
    `${SEARCH_BASE}/api/suggest/get?input=${encodeURIComponent(kw)}` +
    `&type=14&token=${SEARCH_TOKEN}&count=20`;
  const raw = await eastGet<{
    QuotationCodeTable?: { Data?: SuggestRow[] };
  }>(url, `search ${kw}`);
  const rows = raw.QuotationCodeTable?.Data;
  if (!Array.isArray(rows)) return [];

  const out: StockSuggestion[] = [];
  for (const r of rows) {
    if (r.Classify !== "AStock" && r.Classify !== "HK") continue; // 只留 A 股/港股

    // QuoteID 形如 "1.600519" / "0.000333" / "116.00700"，前缀即市场
    const qid = String(r.QuoteID ?? "");
    const m = /^(\d+)\.(\d+)$/.exec(qid);
    if (!m) continue;
    const mktNum = m[1];
    const market =
      mktNum === "1" ? "SH" : mktNum === "0" ? "SZ" : mktNum === "116" ? "HK" : "";
    if (!market) continue;

    // A 股补足 6 位、港股补足 5 位
    const code = String(r.Code ?? "").padStart(
      market === "HK" ? 5 : 6,
      "0",
    );
    if (!/^\d{5,6}$/.test(code)) continue;
    // 港股衍生权证（1xxxx/2xxxx）过滤，只留正股（0xxxx/8xxxx）
    if (market === "HK" && /^[12]/.test(code)) continue;

    const ticker = `${code}.${market}`;
    if (out.some((s) => s.ticker === ticker)) continue;
    out.push({
      ticker,
      name: String(r.Name ?? code),
      market,
    });
    if (out.length >= 20) break;
  }

  // 写入缓存（超上限时淘汰最早一条，Map 迭代序即插入序）
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
  searchCache.set(key, {
    data: out,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  });
  return out;
}

// ============================================================
// 财务数据兜底（A 股专用）
// ============================================================

/** 主表（RPT_F10_FINANCE_MAINFINADATA）：净利润/营收/总股本/总资产/经营现金流 */
const mainFinRowSchema = z.object({
  REPORT_DATE: z.string().nullable().optional(),
  SECURITY_NAME_ABBR: z.string().nullable().optional(),
  PARENTNETPROFIT: z.number().nullable().optional(), // 归母净利润（元）
  TOTALOPERATEREVE: z.number().nullable().optional(), // 营业总收入（元）
  TOTAL_SHARE: z.number().nullable().optional(), // 总股本（股）
  TOTAL_ASSETS_PK: z.number().nullable().optional(), // 总资产（元）
  TOTAL_EQUITY_PK: z.number().nullable().optional(), // 净资产（元，含少数股东，慎用）
  NETCASH_OPERATE_PK: z.number().nullable().optional(), // 经营现金流净额（元）
});
const mainFinSchema = z.object({
  success: z.boolean(),
  result: z
    .object({ data: z.array(mainFinRowSchema).nullable() })
    .nullable(),
});

/** emweb 资产负债表：归母净资产 + 有息负债细项（口径对齐 iFinD ths_interest_bearing_debt_stock） */
const balanceRowSchema = z.object({
  REPORT_DATE: z.string().nullable().optional(),
  MONETARYFUNDS: z.number().nullable().optional(), // 货币资金（元）
  // 有息负债（15 项，与 iFinD 口径逐项验证一致；注意不含应付利息 INTEREST_PAYABLE）
  SHORT_LOAN: z.number().nullable().optional(), // 短期借款
  NONCURRENT_LIAB_1YEAR: z.number().nullable().optional(), // 一年内到期非流动负债
  LONG_LOAN: z.number().nullable().optional(), // 长期借款
  BOND_PAYABLE: z.number().nullable().optional(), // 应付债券
  LEASE_LIAB: z.number().nullable().optional(), // 租赁负债（非流动部分）
  ACCEPT_DEPOSIT_INTERBANK: z.number().nullable().optional(), // 吸收存款及同业存放（金融类）
  BORROW_FUND: z.number().nullable().optional(), // 拆入资金（金融类）
  SELL_REPO_FINASSET: z.number().nullable().optional(), // 卖出回购金融资产款（金融类）
  LONG_PAYABLE: z.number().nullable().optional(), // 长期应付款
  TRADE_FINLIAB_NOTFVTPL: z.number().nullable().optional(), // 交易性金融负债
  SHORT_FIN_PAYABLE: z.number().nullable().optional(), // 短期金融负债
  SHORT_BOND_PAYABLE: z.number().nullable().optional(), // 短期应付债券
  DERIVE_FINLIAB: z.number().nullable().optional(), // 衍生金融负债
  HOLDSALE_LIAB: z.number().nullable().optional(), // 持有待售负债
  PREDICT_CURRENT_LIAB: z.number().nullable().optional(), // 预计流动负债
  TOTAL_PARENT_EQUITY: z.number().nullable().optional(), // 归母净资产（元）
  TOTAL_EQUITY: z.number().nullable().optional(),
  TOTAL_ASSETS: z.number().nullable().optional(),
});
const emwebSchema = z.object({
  data: z.array(balanceRowSchema).nullable().optional(),
});

/** emweb 现金流量表：CFO / Capex / D&A */
const cashflowRowSchema = z.object({
  REPORT_DATE: z.string().nullable().optional(),
  NETCASH_OPERATE: z.number().nullable().optional(), // 经营现金流净额（元）
  CONSTRUCT_LONG_ASSET: z.number().nullable().optional(), // 购建固定资产等支付的现金（Capex，元）
  FA_IR_DEPR: z.number().nullable().optional(), // 固定资产折旧等（略宽，兜底）
  OILGAS_BIOLOGY_DEPR: z.number().nullable().optional(), // 固定资产折旧/油气折耗/生物折旧（对齐 iFinD 口径）
  IA_AMORTIZE: z.number().nullable().optional(), // 无形资产摊销（iFinD D&A 不含）
  LPE_AMORTIZE: z.number().nullable().optional(), // 长期待摊费用摊销（iFinD D&A 不含）
});
const cashflowSchema = z.object({
  data: z.array(cashflowRowSchema).nullable().optional(),
});

/** 与 ifind-client.fetchFinancials 相同的报告期选取：最近一个完整年报 */
function lastAnnualReportDate(): string {
  const now = new Date();
  const year =
    now.getMonth() >= 6 ? now.getFullYear() - 1 : now.getFullYear() - 2;
  return `${year}-12-31`;
}

/**
 * 财务数据兜底（仅 A 股）
 * 返回结构与 ifind-client.fetchFinancials 一致（单位：亿元 / 亿股），
 * 另附 incomplete 标记（港股不支持时直接抛错，避免返回残缺数据）
 */
export async function fetchEastFinancials(ticker: string) {
  if (!/\.(SH|SZ)$/.test(ticker.trim().toUpperCase())) {
    throw new Error(
      `东财财务兜底仅支持 A 股（${ticker} 为港股，iFinD 不可用时无法获取财务数据）`,
    );
  }

  const reportDate = lastAnnualReportDate();
  const code = ticker.trim().toUpperCase().replace(/\.(SH|SZ)$/, "");
  const emCode = toEmCode(ticker);

  // 1) 主表：归母净利润 / 营收 / 总股本 / 总资产 / 经营现金流
  const mainUrl =
    `${DATACENTER_BASE}/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA` +
    "&columns=ALL&pageNumber=1&pageSize=1&sortTypes=-1&sortColumns=REPORT_DATE" +
    `&filter=(SECURITY_CODE%3D%22${code}%22)(REPORT_DATE%3D%27${reportDate}%27)`;
  const mainRaw = await eastGet<unknown>(mainUrl, `financials ${ticker}`);
  const mainParsed = mainFinSchema.safeParse(mainRaw);
  const mainRow = mainParsed.success
    ? mainParsed.data.result?.data?.[0]
    : undefined;
  if (!mainRow) {
    throw new Error(`东财财务主表无 ${ticker} 的 ${reportDate} 年报数据`);
  }

  // 2) 资产负债表（emweb）：归母净资产 / 有息负债
  const balanceUrl =
    `${EMWEB_BASE}/PC_HSF10/NewFinanceAnalysis/ZcfzbAjaxNew` +
    `?companyType=4&reportDateType=0&reportType=1&dates=${reportDate}&code=${emCode}`;
  const balRaw = await eastGet<unknown>(balanceUrl, `balance ${ticker}`);
  const balParsed = emwebSchema.safeParse(balRaw);
  const balRow = balParsed.success ? balParsed.data.data?.[0] : undefined;

  // 3) 现金流量表（emweb）：CFO / Capex / D&A
  const cfUrl =
    `${EMWEB_BASE}/PC_HSF10/NewFinanceAnalysis/XjllbAjaxNew` +
    `?companyType=4&reportDateType=0&reportType=1&dates=${reportDate}&code=${emCode}`;
  const cfRaw = await eastGet<unknown>(cfUrl, `cashflow ${ticker}`);
  const cfParsed = cashflowSchema.safeParse(cfRaw);
  const cfRow = cfParsed.success ? cfParsed.data.data?.[0] : undefined;

  // 归母净资产：优先资产负债表 TOTAL_PARENT_EQUITY；兜底主表 TOTAL_EQUITY_PK（可能含少数股东权益）
  const bookValue =
    balRow?.TOTAL_PARENT_EQUITY ?? mainRow.TOTAL_EQUITY_PK ?? 0;
  // 有息负债：15 项科目求和，口径对齐 iFinD ths_interest_bearing_debt_stock（不含应付利息）
  const DEBT_KEYS = [
    "SHORT_LOAN",
    "NONCURRENT_LIAB_1YEAR",
    "LONG_LOAN",
    "BOND_PAYABLE",
    "LEASE_LIAB",
    "ACCEPT_DEPOSIT_INTERBANK",
    "BORROW_FUND",
    "SELL_REPO_FINASSET",
    "LONG_PAYABLE",
    "TRADE_FINLIAB_NOTFVTPL",
    "SHORT_FIN_PAYABLE",
    "SHORT_BOND_PAYABLE",
    "DERIVE_FINLIAB",
    "HOLDSALE_LIAB",
    "PREDICT_CURRENT_LIAB",
  ] as const;
  const debt = DEBT_KEYS.reduce(
    (sum, k) => sum + (balRow?.[k] ?? 0),
    0,
  );
  // 折旧摊销 = 固定资产折旧/油气折耗/生物折旧（对齐 iFinD ths_depreciation_etc_stock，
  // 不含无形资产摊销、长期待摊摊销）；OILGAS_BIOLOGY_DEPR 为 0 时（如美的）用 FA_IR_DEPR 兜底
  const da = cfRow?.OILGAS_BIOLOGY_DEPR || cfRow?.FA_IR_DEPR || 0;

  // 资产负债表/现金流量表缺失时降级：净资产用主表；CFO 用主表 NETCASH_OPERATE_PK；Capex/D&A 缺失置 0 并标记
  const missingCapex = cfRow?.CONSTRUCT_LONG_ASSET == null;
  const incomplete =
    !balRow || !cfRow || !cfRow.NETCASH_OPERATE || missingCapex;

  const cfo = cfRow?.NETCASH_OPERATE ?? mainRow.NETCASH_OPERATE_PK ?? 0;
  const capex = cfRow?.CONSTRUCT_LONG_ASSET ?? 0;

  const YI = 1e8;
  return {
    ticker,
    name: mainRow.SECURITY_NAME_ABBR || ticker,
    cash: 0, // 与 ifind 口径一致：货币资金暂不填
    debt: Number((debt / YI).toFixed(2)),
    shares: Number(((mainRow.TOTAL_SHARE ?? 0) / 1e8).toFixed(2)),
    cfo: Number((cfo / YI).toFixed(2)),
    capex: Number((capex / YI).toFixed(2)),
    da: Number((da / YI).toFixed(2)),
    e0: Number(((mainRow.PARENTNETPROFIT ?? 0) / YI).toFixed(2)),
    revenue: Number(((mainRow.TOTALOPERATEREVE ?? 0) / YI).toFixed(2)),
    bookValue: Number((bookValue / YI).toFixed(2)),
    totalAssets: Number(
      ((mainRow.TOTAL_ASSETS_PK ?? balRow?.TOTAL_ASSETS ?? 0) / YI).toFixed(2),
    ),
    reportDate,
    incomplete,
  };
}
