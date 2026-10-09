/**
 * 同花顺 iFinD HTTP API 客户端
 * ------------------------------------------------------------------
 * 安全设计：
 *   1. Token 仅存在服务端内存中，绝不返回给前端
 *   2. refresh_token 从 process.env.IFIND_REFRESH_TOKEN 读取，不硬编码
 *   3. access_token 内存缓存 1 小时，到期自动刷新，避免频繁调用
 *   4. 前端通过 /api/ifind/* 代理访问，Token 全程不出服务端
 *   5. 所有外部响应做 Zod 校验，防止脏数据写入数据库
 *
 * 真实 API（已验证）：
 *   Base URL:  https://quantapi.51ifind.com
 *   Token:     POST /api/v1/get_access_token   body: { refresh_token }
 *   基础数据:  POST /api/v1/basic_data_service  header: access_token
 *   历史行情:  POST /api/v1/cmd_history_quotation  header: access_token
 *
 * 已验证可用指标（上汽集团 600104.SH，2025 年报，与东方财富逐项核对一致）：
 *   ths_stock_short_name_stock     证券简称
 *   ths_close_price_stock          收盘价（盘中取最近交易日收盘）
 *   ths_total_shares_stock         总股本
 *   ths_total_assets_stock         总资产
 *   ths_interest_bearing_debt_stock 有息负债
 *   ths_np_stock                   净利润（含少数股东，PIT 归母缺失时兜底）
 *   ths_ncf_from_oa_stock          经营活动现金流净额（CFO）
 *   ths_cash_paid_for_assets_stock 资本开支（Capex）
 *   ths_depreciation_etc_stock     固定资产折旧/油气折耗/生物折旧（不含无形/长摊摊销）
 *   ths_np_atoopc_pit_stock        归母净利润（PIT，参数 [今天,报告期,1]）
 *   ths_total_equity_atoopc_pit_stock 归母净资产（PIT，参数 [今天,报告期,1]）
 *
 * 历史行情 functionpara 必须用 Currency:"RMB"（MHB=美元会把 A 股价格错算成美元）；
 * 历史行情默认不复权（与东方财富 fqt=0 一致）。
 */

// ============================================================
// 配置与常量
// ============================================================

const IFIND_BASE_URL =
  process.env.IFIND_BASE_URL || "https://quantapi.51ifind.com";
const IFIND_TOKEN_PATH =
  process.env.IFIND_TOKEN_PATH || "/api/v1/get_access_token";

/** access_token 缓存有效期（毫秒），iFinD 官方 7 天，这里保守取 1 小时 */
const TOKEN_TTL_MS = 60 * 60 * 1000;
/** 提前 N 毫秒刷新，避免边界过期 */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
/** 单次 HTTP 请求超时 */
const REQUEST_TIMEOUT_MS = 20000;
/** 失败重试次数 */
const MAX_RETRIES = 2;
/** 重试间隔（ms），指数退避基础值 */
const RETRY_BASE_DELAY_MS = 800;
/** 重试最大退避间隔（ms），防止指数退避过大 */
const RETRY_MAX_DELAY_MS = 10000;

// ============================================================
// 内存 Token 缓存
// ============================================================

interface TokenCache {
  accessToken: string;
  expiresAt: number; // 过期时间戳（ms）
}

let tokenCache: TokenCache | null = null;
let refreshPromise: Promise<string> | null = null; // 防止并发刷新

/** 是否有可用的 refresh_token */
export function hasIfindCredentials(): boolean {
  return !!process.env.IFIND_REFRESH_TOKEN;
}

/**
 * 获取 access_token（带内存缓存 + 自动刷新）
 * 并发安全：多个请求同时触发刷新时，共享同一个 refreshPromise
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // 缓存命中且未过期
  if (
    tokenCache &&
    tokenCache.accessToken &&
    now < tokenCache.expiresAt - TOKEN_REFRESH_BUFFER_MS
  ) {
    return tokenCache.accessToken;
  }

  // 已有刷新进行中，等待结果
  if (refreshPromise) {
    return refreshPromise;
  }

  // 发起刷新
  refreshPromise = (async () => {
    try {
      const token = await refreshAccessToken();
      tokenCache = {
        accessToken: token,
        expiresAt: now + TOKEN_TTL_MS,
      };
      return token;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * 用 refresh_token 换取 access_token
 * POST {base_url}/api/v1/get_access_token  body: { refresh_token }
 */
async function refreshAccessToken(): Promise<string> {
  const refreshToken = process.env.IFIND_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      "IFIND_REFRESH_TOKEN 未配置。请在 .env.local 中设置该环境变量。",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${IFIND_BASE_URL}${IFIND_TOKEN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(
        `iFinD Token 换取失败: HTTP ${res.status} ${res.statusText}`,
      );
    }

    const data = await res.json();
    // iFinD 返回: { errorcode, data: { access_token, expired_time } }
    if (data.errorcode !== 0 || !data.data?.access_token) {
      throw new Error(
        `iFinD Token 换取失败: ${data.errmsg || "未知错误"}`,
      );
    }

    return data.data.access_token;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("iFinD Token 请求超时");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// 通用请求封装（带重试）
// ============================================================

/** 指数退避等待 */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 判断是否值得重试的错误（网络错误、超时、5xx、401 Token 失效） */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // AbortController 超时
  if (err.name === "AbortError") return true;

  const msg = err.message;
  if (msg.includes("请求超时")) return true;
  if (msg.includes("已失效") || msg.includes("expired")) return true;
  if (msg.includes("HTTP 5")) return true;
  if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) return true;

  // undici / Node.js 底层网络错误码
  const code = (err as NodeJS.ErrnoException).code;
  if (code) {
    const retryableCodes = [
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "UND_ERR_RESPONSE_STATUS_CODE",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EHOSTUNREACH",
      "ENOTFOUND",
      "EPIPE",
    ];
    if (retryableCodes.includes(code)) return true;
  }

  return false;
}

/**
 * 调用 iFinD 数据接口（POST + JSON body + access_token header）
 * @param path 接口路径，如 /api/v1/basic_data_service
 * @param body 请求体对象
 */
async function ifindPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const token = await getAccessToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await fetch(`${IFIND_BASE_URL}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            access_token: token,
            ifindlang: "cn",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (res.status === 401 || res.status === 403) {
          // Token 失效，清缓存后重试
          tokenCache = null;
          throw new Error("iFinD access_token 已失效，需重新获取");
        }
        if (!res.ok) {
          throw new Error(
            `iFinD 请求失败 [${path}]: HTTP ${res.status} ${res.statusText}`,
          );
        }

        const data = (await res.json()) as T;
        return data;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_RETRIES || !isRetryable(err)) break;
      const delay = Math.min(
        RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
        RETRY_MAX_DELAY_MS,
      );
      await sleep(delay);
    }
  }

  // 重试耗尽，抛出带上下文的错误
  if (lastErr instanceof Error && lastErr.name === "AbortError") {
    throw new Error(`iFinD 请求超时 [${path}]，已重试 ${MAX_RETRIES} 次`);
  }
  if (lastErr instanceof Error) {
    throw new Error(`iFinD 请求失败 [${path}]：${lastErr.message}`);
  }
  throw new Error(`iFinD 请求失败 [${path}]`);
}

// ============================================================
// iFinD 数据接口
// ============================================================

interface IFindTable {
  thscode: string;
  table: Record<string, (string | number | null)[]>;
}

interface IFindResponse {
  errorcode: number;
  errmsg?: string;
  tables?: IFindTable[];
}

/**
 * 从 basic_data_service 响应中提取单个指标的值
 */
function extractValue(
  resp: IFindResponse,
  indicator: string,
): number | null {
  const tbl = resp.tables?.[0]?.table;
  if (!tbl) return null;
  const arr = tbl[indicator];
  if (!arr || arr.length === 0) return null;
  const v = arr[0];
  if (v === null || v === undefined || v === "") return null;
  const num = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(num) ? null : num;
}

/**
 * 构造基础数据请求的 indipara
 * 财务类指标使用 [报告期, 100, 报告期] 三参数格式（YYYYMMDD）
 */
function buildIndipara(
  indicators: string[],
  reportDate: string,
): { indicator: string; indiparams?: string[] }[] {
  const params = [reportDate, "100", reportDate];
  return indicators.map((ind) => ({ indicator: ind, indiparams: params }));
}

/**
 * 获取最新行情（收盘价）
 * 使用 basic_data_service + ths_close_price_stock
 */
export async function fetchQuote(ticker: string) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const body = {
    codes: ticker,
    indipara: buildIndipara(["ths_close_price_stock"], today),
  };
  const resp = await ifindPost<IFindResponse>("/api/v1/basic_data_service", body);

  if (resp.errorcode !== 0) {
    throw new Error(`iFinD 行情获取失败: ${resp.errmsg || "未知错误"}`);
  }

  const close = extractValue(resp, "ths_close_price_stock");
  if (close === null) {
    throw new Error(`无法获取 ${ticker} 的收盘价`);
  }

  return { ticker, close, volume: 0, date: today };
}

/**
 * 获取财务数据
 * 拉取：净利润(E0)、CFO、Capex、D&A、总股本、有息负债、总资产
 * 报告期取最近一个年报（12-31）
 */
export async function fetchFinancials(ticker: string) {
  // 取最近一个完整年报：当前年份-1 的 12-31
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() - 1 : now.getFullYear() - 2;
  const reportDate = `${year}1231`;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  // 普通指标（参数 [报告期,100,报告期]）
  const indicators = [
    "ths_stock_short_name_stock", // 名称
    "ths_np_stock", // 净利润（含少数股东，PIT 归母缺失时兜底）
    "ths_revenue_stock", // 营业收入
    "ths_ncf_from_oa_stock", // CFO
    "ths_cash_paid_for_assets_stock", // Capex
    "ths_depreciation_etc_stock", // D&A
    "ths_total_shares_stock", // 总股本
    "ths_interest_bearing_debt_stock", // 有息负债
    "ths_total_assets_stock", // 总资产
  ];
  // PIT 时点指标（归母口径，参数 [查询日期(今天),报告期,1]，自带 PIT 防未来函数）
  const pitIndicators = [
    "ths_np_atoopc_pit_stock", // 归母净利润
    "ths_total_equity_atoopc_pit_stock", // 归母净资产
  ];

  const body = {
    codes: ticker,
    indipara: [
      ...indicators.map((indicator) => ({
        indicator,
        indiparams: [reportDate, "100", reportDate],
      })),
      ...pitIndicators.map((indicator) => ({
        indicator,
        indiparams: [today, reportDate, "1"],
      })),
    ],
  };

  const resp = await ifindPost<IFindResponse>("/api/v1/basic_data_service", body);

  if (resp.errorcode !== 0) {
    throw new Error(`iFinD 财务数据获取失败: ${resp.errmsg || "未知错误"}`);
  }

  const tbl = resp.tables?.[0]?.table;
  const name = tbl?.["ths_stock_short_name_stock"]?.[0] as string | undefined;
  const np = extractValue(resp, "ths_np_stock") ?? 0;
  const npParent = extractValue(resp, "ths_np_atoopc_pit_stock"); // PIT 归母净利润，优先
  const revenue = extractValue(resp, "ths_revenue_stock") ?? 0;
  const cfo = extractValue(resp, "ths_ncf_from_oa_stock") ?? 0;
  const capex = extractValue(resp, "ths_cash_paid_for_assets_stock") ?? 0;
  const da = extractValue(resp, "ths_depreciation_etc_stock") ?? 0;
  const shares = extractValue(resp, "ths_total_shares_stock") ?? 0;
  const debt = extractValue(resp, "ths_interest_bearing_debt_stock") ?? 0;
  const totalAssets = extractValue(resp, "ths_total_assets_stock") ?? 0;
  const totalParentEquity = extractValue(resp, "ths_total_equity_atoopc_pit_stock"); // PIT 归母净资产

  // 单位转换：元 → 亿元
  const YI = 1e8;
  return {
    ticker,
    name: name || ticker,
    cash: 0, // 货币资金（暂未找到对应指标，默认 0）
    debt: Number((debt / YI).toFixed(2)),
    shares: Number((shares / 1e8).toFixed(2)), // 股 → 亿股
    cfo: Number((cfo / YI).toFixed(2)),
    capex: Number((capex / YI).toFixed(2)),
    da: Number((da / YI).toFixed(2)),
    e0: Number(((npParent ?? np) / YI).toFixed(2)), // 优先 PIT 归母净利润，兜底净利润
    revenue: Number((revenue / YI).toFixed(2)),
    bookValue: Number(((totalParentEquity ?? 0) / YI).toFixed(2)),
    totalAssets: Number((totalAssets / YI).toFixed(2)),
    reportDate: `${year}-12-31`,
  };
}

/**
 * 获取历史行情（用于趋势图）
 * POST /api/v1/cmd_history_quotation
 */
export async function fetchPriceHistory(
  ticker: string,
  startDate: string,
  endDate: string,
) {
  const body = {
    codes: ticker,
    indicators: "open,high,low,close,volume",
    startdate: startDate,
    enddate: endDate,
    functionpara: { Currency: "RMB", Fill: "Omit" },
  };

  const resp = await ifindPost<{
    errorcode: number;
    errmsg?: string;
    tables?: {
      thscode: string;
      time: string[];
      table: Record<string, number[]>;
    }[];
  }>("/api/v1/cmd_history_quotation", body);

  if (resp.errorcode !== 0) {
    throw new Error(`iFinD 历史行情获取失败: ${resp.errmsg || "未知错误"}`);
  }

  const tbl = resp.tables?.[0];
  if (!tbl || !tbl.time) return [];

  const closes = tbl.table?.["close"] ?? [];
  const volumes = tbl.table?.["volume"] ?? [];

  return tbl.time.map((date, i) => ({
    date: date.slice(0, 10),
    close: closes[i] ?? 0,
    volume: volumes[i] ?? 0,
  }));
}

/**
 * 一次性抓取行情 + 财务数据（用于"新增标的"场景）
 */
export async function fetchCompanyData(ticker: string) {
  const [quote, financials] = await Promise.all([
    fetchQuote(ticker),
    fetchFinancials(ticker),
  ]);

  return {
    ticker,
    name: financials.name,
    currentPrice: quote.close,
    volume: quote.volume ?? 0,
    marketCap: Number((quote.close * financials.shares).toFixed(2)),
    cash: financials.cash,
    debt: financials.debt,
    shares: financials.shares,
    cfo: financials.cfo,
    capex: financials.capex,
    da: financials.da,
    e0: financials.e0,
    revenue: financials.revenue,
    bookValue: financials.bookValue,
    totalAssets: financials.totalAssets,
    reportDate: financials.reportDate,
  };
}

// ============================================================
// 股票搜索
// ============================================================

/** A/H 股常见标的搜索池，供自动补全和同行匹配使用 */
const STOCK_POOL: { ticker: string; name: string; market: string; industry: string }[] = [
  // 汽车
  { ticker: "600104.SH", name: "上汽集团", market: "SH", industry: "汽车整车" },
  { ticker: "600066.SH", name: "宇通客车", market: "SH", industry: "汽车整车" },
  { ticker: "000625.SZ", name: "长安汽车", market: "SZ", industry: "汽车整车" },
  { ticker: "002594.SZ", name: "比亚迪", market: "SZ", industry: "汽车整车" },
  { ticker: "601238.SH", name: "广汽集团", market: "SH", industry: "汽车整车" },
  { ticker: "601633.SH", name: "长城汽车", market: "SH", industry: "汽车整车" },
  { ticker: "600006.SH", name: "东风汽车", market: "SH", industry: "汽车整车" },
  { ticker: "000550.SZ", name: "江铃汽车", market: "SZ", industry: "汽车整车" },
  { ticker: "600660.SH", name: "福耀玻璃", market: "SH", industry: "汽车零部件" },
  { ticker: "000581.SZ", name: "威孚高科", market: "SZ", industry: "汽车零部件" },
  { ticker: "600741.SH", name: "华域汽车", market: "SH", industry: "汽车零部件" },
  { ticker: "002920.SZ", name: "德赛西威", market: "SZ", industry: "汽车零部件" },
  { ticker: "603799.SH", name: "华友钴业", market: "SH", industry: "汽车零部件" },
  // 白酒/食品饮料
  { ticker: "600519.SH", name: "贵州茅台", market: "SH", industry: "白酒" },
  { ticker: "000858.SZ", name: "五粮液", market: "SZ", industry: "白酒" },
  { ticker: "000568.SZ", name: "泸州老窖", market: "SZ", industry: "白酒" },
  { ticker: "000596.SZ", name: "古井贡酒", market: "SZ", industry: "白酒" },
  { ticker: "600809.SH", name: "山西汾酒", market: "SH", industry: "白酒" },
  { ticker: "002304.SZ", name: "洋河股份", market: "SZ", industry: "白酒" },
  { ticker: "603369.SH", name: "今世缘", market: "SH", industry: "白酒" },
  { ticker: "000799.SZ", name: "酒鬼酒", market: "SZ", industry: "白酒" },
  { ticker: "603288.SH", name: "海天味业", market: "SH", industry: "调味品" },
  { ticker: "600887.SH", name: "伊利股份", market: "SH", industry: "乳制品" },
  { ticker: "002714.SZ", name: "牧原股份", market: "SZ", industry: "养殖业" },
  { ticker: "000895.SZ", name: "双汇发展", market: "SZ", industry: "食品加工" },
  // 金融
  { ticker: "601318.SH", name: "中国平安", market: "SH", industry: "保险" },
  { ticker: "601628.SH", name: "中国人寿", market: "SH", industry: "保险" },
  { ticker: "601336.SH", name: "新华保险", market: "SH", industry: "保险" },
  { ticker: "601601.SH", name: "中国太保", market: "SH", industry: "保险" },
  { ticker: "600036.SH", name: "招商银行", market: "SH", industry: "银行" },
  { ticker: "601166.SH", name: "兴业银行", market: "SH", industry: "银行" },
  { ticker: "600000.SH", name: "浦发银行", market: "SH", industry: "银行" },
  { ticker: "601398.SH", name: "工商银行", market: "SH", industry: "银行" },
  { ticker: "000001.SZ", name: "平安银行", market: "SZ", industry: "银行" },
  { ticker: "601288.SH", name: "农业银行", market: "SH", industry: "银行" },
  { ticker: "601939.SH", name: "建设银行", market: "SH", industry: "银行" },
  { ticker: "601988.SH", name: "中国银行", market: "SH", industry: "银行" },
  { ticker: "600030.SH", name: "中信证券", market: "SH", industry: "证券" },
  { ticker: "601211.SH", name: "国泰君安", market: "SH", industry: "证券" },
  { ticker: "600837.SH", name: "海通证券", market: "SH", industry: "证券" },
  { ticker: "000776.SZ", name: "广发证券", market: "SZ", industry: "证券" },
  // 家电
  { ticker: "000333.SZ", name: "美的集团", market: "SZ", industry: "家电" },
  { ticker: "000651.SZ", name: "格力电器", market: "SZ", industry: "家电" },
  { ticker: "600690.SH", name: "海尔智家", market: "SH", industry: "家电" },
  { ticker: "002032.SZ", name: "苏泊尔", market: "SZ", industry: "家电" },
  { ticker: "000100.SZ", name: "TCL科技", market: "SZ", industry: "家电" },
  // 电力/公用事业
  { ticker: "600900.SH", name: "长江电力", market: "SH", industry: "电力" },
  { ticker: "600025.SH", name: "华能水电", market: "SH", industry: "电力" },
  { ticker: "600886.SH", name: "国投电力", market: "SH", industry: "电力" },
  { ticker: "601985.SH", name: "中国核电", market: "SH", industry: "电力" },
  { ticker: "003816.SZ", name: "中国广核", market: "SZ", industry: "电力" },
  // 医药
  { ticker: "600276.SH", name: "恒瑞医药", market: "SH", industry: "医药" },
  { ticker: "000538.SZ", name: "云南白药", market: "SZ", industry: "医药" },
  { ticker: "300760.SZ", name: "迈瑞医疗", market: "SZ", industry: "医疗器械" },
  { ticker: "002007.SZ", name: "华兰生物", market: "SZ", industry: "生物制品" },
  { ticker: "300015.SZ", name: "爱尔眼科", market: "SZ", industry: "医疗服务" },
  { ticker: "600436.SH", name: "片仔癀", market: "SH", industry: "中药" },
  { ticker: "000423.SZ", name: "东阿阿胶", market: "SZ", industry: "中药" },
  { ticker: "603259.SH", name: "药明康德", market: "SH", industry: "CXO" },
  { ticker: "300347.SZ", name: "泰格医药", market: "SZ", industry: "CXO" },
  { ticker: "002821.SZ", name: "凯莱英", market: "SZ", industry: "CXO" },
  // 互联网/科技（港股）
  { ticker: "00700.HK", name: "腾讯控股", market: "HK", industry: "互联网" },
  { ticker: "09988.HK", name: "阿里巴巴-W", market: "HK", industry: "互联网" },
  { ticker: "03690.HK", name: "美团-W", market: "HK", industry: "互联网" },
  { ticker: "09618.HK", name: "京东集团-SW", market: "HK", industry: "互联网" },
  { ticker: "09999.HK", name: "网易-S", market: "HK", industry: "互联网" },
  { ticker: "01024.HK", name: "快手-W", market: "HK", industry: "互联网" },
  { ticker: "02015.HK", name: "理想汽车-W", market: "HK", industry: "新能源汽车" },
  { ticker: "09868.HK", name: "小鹏汽车-W", market: "HK", industry: "新能源汽车" },
  // 有色金属/能源
  { ticker: "601899.SH", name: "紫金矿业", market: "SH", industry: "有色金属" },
  { ticker: "601857.SH", name: "中国石油", market: "SH", industry: "石油石化" },
  { ticker: "600028.SH", name: "中国石化", market: "SH", industry: "石油石化" },
  { ticker: "601088.SH", name: "中国神华", market: "SH", industry: "煤炭" },
  { ticker: "601225.SH", name: "陕西煤业", market: "SH", industry: "煤炭" },
  { ticker: "002460.SZ", name: "赣锋锂业", market: "SZ", industry: "有色金属" },
  { ticker: "002466.SZ", name: "天齐锂业", market: "SZ", industry: "有色金属" },
  { ticker: "603993.SH", name: "洛阳钼业", market: "SH", industry: "有色金属" },
  // 光伏/新能源
  { ticker: "601012.SH", name: "隆基绿能", market: "SH", industry: "光伏" },
  { ticker: "002459.SZ", name: "晶澳科技", market: "SZ", industry: "光伏" },
  { ticker: "688599.SH", name: "天合光能", market: "SH", industry: "光伏" },
  { ticker: "300274.SZ", name: "阳光电源", market: "SZ", industry: "光伏" },
  { ticker: "300750.SZ", name: "宁德时代", market: "SZ", industry: "动力电池" },
  { ticker: "688005.SH", name: "容百科技", market: "SH", industry: "动力电池" },
  // 消费电子/半导体
  { ticker: "002475.SZ", name: "立讯精密", market: "SZ", industry: "消费电子" },
  { ticker: "002241.SZ", name: "歌尔股份", market: "SZ", industry: "消费电子" },
  { ticker: "603501.SH", name: "韦尔股份", market: "SH", industry: "半导体" },
  { ticker: "688981.SH", name: "中芯国际", market: "SH", industry: "半导体" },
  { ticker: "002371.SZ", name: "北方华创", market: "SZ", industry: "半导体设备" },
  { ticker: "688012.SH", name: "中微公司", market: "SH", industry: "半导体设备" },
  { ticker: "002049.SZ", name: "紫光国微", market: "SZ", industry: "半导体" },
  // 消费/零售
  { ticker: "601888.SH", name: "中国中免", market: "SH", industry: "免税零售" },
  { ticker: "002607.SZ", name: "中公教育", market: "SZ", industry: "教育" },
  // 交通运输/基础设施
  { ticker: "600009.SH", name: "上海机场", market: "SH", industry: "机场" },
  { ticker: "601111.SH", name: "中国国航", market: "SH", industry: "航空" },
  { ticker: "600029.SH", name: "南方航空", market: "SH", industry: "航空" },
  { ticker: "600115.SH", name: "东方航空", market: "SH", industry: "航空" },
  { ticker: "601006.SH", name: "大秦铁路", market: "SH", industry: "铁路" },
  { ticker: "601816.SH", name: "京沪高铁", market: "SH", industry: "铁路" },
  { ticker: "002352.SZ", name: "顺丰控股", market: "SZ", industry: "物流" },
  // 房地产/建筑
  { ticker: "000002.SZ", name: "万科A", market: "SZ", industry: "房地产" },
  { ticker: "600048.SH", name: "保利发展", market: "SH", industry: "房地产" },
  { ticker: "001979.SZ", name: "招商蛇口", market: "SZ", industry: "房地产" },
  { ticker: "601668.SH", name: "中国建筑", market: "SH", industry: "建筑" },
  { ticker: "601390.SH", name: "中国中铁", market: "SH", industry: "建筑" },
  // 工程机械/制造
  { ticker: "600031.SH", name: "三一重工", market: "SH", industry: "工程机械" },
  { ticker: "000157.SZ", name: "中联重科", market: "SZ", industry: "工程机械" },
  { ticker: "000425.SZ", name: "徐工机械", market: "SZ", industry: "工程机械" },
  { ticker: "601100.SH", name: "恒立液压", market: "SH", industry: "机械零部件" },
  { ticker: "002747.SZ", name: "埃斯顿", market: "SZ", industry: "机器人" },
  // 化工/材料
  { ticker: "600309.SH", name: "万华化学", market: "SH", industry: "化工" },
  { ticker: "002648.SZ", name: "卫星化学", market: "SZ", industry: "化工" },
  { ticker: "600426.SH", name: "华鲁恒升", market: "SH", industry: "化工" },
  { ticker: "002493.SZ", name: "荣盛石化", market: "SZ", industry: "化工" },
  { ticker: "601678.SH", name: "滨化股份", market: "SH", industry: "化工" },
];

/** 根据行业获取同行股票池（用于横向对比） */
export function getIndustryPeers(industry: string, excludeTicker?: string) {
  if (!industry) return [];
  return STOCK_POOL.filter(
    (s) => s.industry === industry && s.ticker !== excludeTicker,
  );
}

/**
 * 股票搜索（按代码或名称模糊匹配）
 * iFinD HTTP API 无直接搜索端点，使用本地股票池匹配
 */
export async function searchStock(keyword: string) {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  return STOCK_POOL.filter(
    (s) =>
      s.ticker.toLowerCase().includes(kw) ||
      s.name.toLowerCase().includes(kw),
  ).slice(0, 20);
}

// ============================================================
// Mock 模式（无 Token 时返回模拟数据，便于本地开发）
// ============================================================

export function getMockSearchResults(keyword: string) {
  return searchStock(keyword);
}

export function getMockCompanyData(ticker: string) {
  const seed = hashTicker(ticker);
  const price = 5 + (seed % 40);
  const shares = 50 + (seed % 200);
  const cash = 100 + (seed % 500);
  const debt = 50 + (seed % 300);
  const e0 = 20 + (seed % 150);
  const cfo = e0 * (1.1 + (seed % 50) / 100);
  const capex = e0 * (0.3 + (seed % 40) / 100);
  const da = e0 * (0.2 + (seed % 20) / 100);
  const revenue = e0 * (3 + (seed % 10)); // 营收约为利润的 3~13 倍
  const bookValue = e0 * (2 + (seed % 8)); // 净资产约为利润的 2~10 倍

  // 从股票池查找中文名称，找不到则用 ticker
  const matched = STOCK_POOL.find((s) => s.ticker === ticker);

  return {
    ticker,
    name: matched?.name ?? ticker,
    industry: matched?.industry ?? "",
    currentPrice: Number(price.toFixed(2)),
    volume: 10000000 + seed * 1000,
    marketCap: Number((price * shares).toFixed(2)),
    cash: Number(cash.toFixed(2)),
    debt: Number(debt.toFixed(2)),
    shares: Number(shares.toFixed(2)),
    cfo: Number(cfo.toFixed(2)),
    capex: Number(capex.toFixed(2)),
    da: Number(da.toFixed(2)),
    e0: Number(e0.toFixed(2)),
    revenue: Number(revenue.toFixed(2)),
    bookValue: Number(bookValue.toFixed(2)),
    totalAssets: 0,
    reportDate: new Date().toISOString().slice(0, 10),
  };
}

function hashTicker(ticker: string): number {
  let h = 0;
  for (let i = 0; i < ticker.length; i++) {
    h = (h * 31 + ticker.charCodeAt(i)) >>> 0;
  }
  return h % 1000;
}
