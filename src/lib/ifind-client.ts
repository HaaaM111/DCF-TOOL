

const IFIND_BASE_URL =
  process.env.IFIND_BASE_URL || "https://quantapi.51ifind.com";
const IFIND_TOKEN_PATH =
  process.env.IFIND_TOKEN_PATH || "/api/v1/get_access_token";

const TOKEN_TTL_MS = 60 * 60 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 800;
const RETRY_MAX_DELAY_MS = 10000;

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;
let refreshPromise: Promise<string> | null = null;

export function hasIfindCredentials(): boolean {
  return !!process.env.IFIND_REFRESH_TOKEN;
}

export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  if (
    tokenCache &&
    tokenCache.accessToken &&
    now < tokenCache.expiresAt - TOKEN_REFRESH_BUFFER_MS
  ) {
    return tokenCache.accessToken;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  if (err.name === "AbortError") return true;

  const msg = err.message;
  if (msg.includes("请求超时")) return true;
  if (msg.includes("已失效") || msg.includes("expired")) return true;
  if (msg.includes("HTTP 5")) return true;
  if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) return true;

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

  if (lastErr instanceof Error && lastErr.name === "AbortError") {
    throw new Error(`iFinD 请求超时 [${path}]，已重试 ${MAX_RETRIES} 次`);
  }
  if (lastErr instanceof Error) {
    throw new Error(`iFinD 请求失败 [${path}]：${lastErr.message}`);
  }
  throw new Error(`iFinD 请求失败 [${path}]`);
}

interface IFindTable {
  thscode: string;
  table: Record<string, (string | number | null)[]>;
}

interface IFindResponse {
  errorcode: number;
  errmsg?: string;
  tables?: IFindTable[];
}

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

function buildIndipara(
  indicators: string[],
  reportDate: string,
): { indicator: string; indiparams?: string[] }[] {
  const params = [reportDate, "100", reportDate];
  return indicators.map((ind) => ({ indicator: ind, indiparams: params }));
}

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

export async function fetchFinancials(ticker: string) {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() - 1 : now.getFullYear() - 2;
  const reportDate = `${year}1231`;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

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
  const npParent = extractValue(resp, "ths_np_atoopc_pit_stock");
  const revenue = extractValue(resp, "ths_revenue_stock") ?? 0;
  const cfo = extractValue(resp, "ths_ncf_from_oa_stock") ?? 0;
  const capex = extractValue(resp, "ths_cash_paid_for_assets_stock") ?? 0;
  const da = extractValue(resp, "ths_depreciation_etc_stock") ?? 0;
  const shares = extractValue(resp, "ths_total_shares_stock") ?? 0;
  const debt = extractValue(resp, "ths_interest_bearing_debt_stock") ?? 0;
  const totalAssets = extractValue(resp, "ths_total_assets_stock") ?? 0;
  const totalParentEquity = extractValue(resp, "ths_total_equity_atoopc_pit_stock");

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

const STOCK_POOL: { ticker: string; name: string; market: string; industry: string }[] = [
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
  { ticker: "000333.SZ", name: "美的集团", market: "SZ", industry: "家电" },
  { ticker: "000651.SZ", name: "格力电器", market: "SZ", industry: "家电" },
  { ticker: "600690.SH", name: "海尔智家", market: "SH", industry: "家电" },
  { ticker: "002032.SZ", name: "苏泊尔", market: "SZ", industry: "家电" },
  { ticker: "000100.SZ", name: "TCL科技", market: "SZ", industry: "家电" },
  { ticker: "600900.SH", name: "长江电力", market: "SH", industry: "电力" },
  { ticker: "600025.SH", name: "华能水电", market: "SH", industry: "电力" },
  { ticker: "600886.SH", name: "国投电力", market: "SH", industry: "电力" },
  { ticker: "601985.SH", name: "中国核电", market: "SH", industry: "电力" },
  { ticker: "003816.SZ", name: "中国广核", market: "SZ", industry: "电力" },
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
  { ticker: "00700.HK", name: "腾讯控股", market: "HK", industry: "互联网" },
  { ticker: "09988.HK", name: "阿里巴巴-W", market: "HK", industry: "互联网" },
  { ticker: "03690.HK", name: "美团-W", market: "HK", industry: "互联网" },
  { ticker: "09618.HK", name: "京东集团-SW", market: "HK", industry: "互联网" },
  { ticker: "09999.HK", name: "网易-S", market: "HK", industry: "互联网" },
  { ticker: "01024.HK", name: "快手-W", market: "HK", industry: "互联网" },
  { ticker: "02015.HK", name: "理想汽车-W", market: "HK", industry: "新能源汽车" },
  { ticker: "09868.HK", name: "小鹏汽车-W", market: "HK", industry: "新能源汽车" },
  { ticker: "601899.SH", name: "紫金矿业", market: "SH", industry: "有色金属" },
  { ticker: "601857.SH", name: "中国石油", market: "SH", industry: "石油石化" },
  { ticker: "600028.SH", name: "中国石化", market: "SH", industry: "石油石化" },
  { ticker: "601088.SH", name: "中国神华", market: "SH", industry: "煤炭" },
  { ticker: "601225.SH", name: "陕西煤业", market: "SH", industry: "煤炭" },
  { ticker: "002460.SZ", name: "赣锋锂业", market: "SZ", industry: "有色金属" },
  { ticker: "002466.SZ", name: "天齐锂业", market: "SZ", industry: "有色金属" },
  { ticker: "603993.SH", name: "洛阳钼业", market: "SH", industry: "有色金属" },
  { ticker: "601012.SH", name: "隆基绿能", market: "SH", industry: "光伏" },
  { ticker: "002459.SZ", name: "晶澳科技", market: "SZ", industry: "光伏" },
  { ticker: "688599.SH", name: "天合光能", market: "SH", industry: "光伏" },
  { ticker: "300274.SZ", name: "阳光电源", market: "SZ", industry: "光伏" },
  { ticker: "300750.SZ", name: "宁德时代", market: "SZ", industry: "动力电池" },
  { ticker: "688005.SH", name: "容百科技", market: "SH", industry: "动力电池" },
  { ticker: "002475.SZ", name: "立讯精密", market: "SZ", industry: "消费电子" },
  { ticker: "002241.SZ", name: "歌尔股份", market: "SZ", industry: "消费电子" },
  { ticker: "603501.SH", name: "韦尔股份", market: "SH", industry: "半导体" },
  { ticker: "688981.SH", name: "中芯国际", market: "SH", industry: "半导体" },
  { ticker: "002371.SZ", name: "北方华创", market: "SZ", industry: "半导体设备" },
  { ticker: "688012.SH", name: "中微公司", market: "SH", industry: "半导体设备" },
  { ticker: "002049.SZ", name: "紫光国微", market: "SZ", industry: "半导体" },
  { ticker: "601888.SH", name: "中国中免", market: "SH", industry: "免税零售" },
  { ticker: "002607.SZ", name: "中公教育", market: "SZ", industry: "教育" },
  { ticker: "600009.SH", name: "上海机场", market: "SH", industry: "机场" },
  { ticker: "601111.SH", name: "中国国航", market: "SH", industry: "航空" },
  { ticker: "600029.SH", name: "南方航空", market: "SH", industry: "航空" },
  { ticker: "600115.SH", name: "东方航空", market: "SH", industry: "航空" },
  { ticker: "601006.SH", name: "大秦铁路", market: "SH", industry: "铁路" },
  { ticker: "601816.SH", name: "京沪高铁", market: "SH", industry: "铁路" },
  { ticker: "002352.SZ", name: "顺丰控股", market: "SZ", industry: "物流" },
  { ticker: "000002.SZ", name: "万科A", market: "SZ", industry: "房地产" },
  { ticker: "600048.SH", name: "保利发展", market: "SH", industry: "房地产" },
  { ticker: "001979.SZ", name: "招商蛇口", market: "SZ", industry: "房地产" },
  { ticker: "601668.SH", name: "中国建筑", market: "SH", industry: "建筑" },
  { ticker: "601390.SH", name: "中国中铁", market: "SH", industry: "建筑" },
  { ticker: "600031.SH", name: "三一重工", market: "SH", industry: "工程机械" },
  { ticker: "000157.SZ", name: "中联重科", market: "SZ", industry: "工程机械" },
  { ticker: "000425.SZ", name: "徐工机械", market: "SZ", industry: "工程机械" },
  { ticker: "601100.SH", name: "恒立液压", market: "SH", industry: "机械零部件" },
  { ticker: "002747.SZ", name: "埃斯顿", market: "SZ", industry: "机器人" },
  { ticker: "600309.SH", name: "万华化学", market: "SH", industry: "化工" },
  { ticker: "002648.SZ", name: "卫星化学", market: "SZ", industry: "化工" },
  { ticker: "600426.SH", name: "华鲁恒升", market: "SH", industry: "化工" },
  { ticker: "002493.SZ", name: "荣盛石化", market: "SZ", industry: "化工" },
  { ticker: "601678.SH", name: "滨化股份", market: "SH", industry: "化工" },
];

export function getIndustryPeers(industry: string, excludeTicker?: string) {
  if (!industry) return [];
  return STOCK_POOL.filter(
    (s) => s.industry === industry && s.ticker !== excludeTicker,
  );
}

export async function searchStock(keyword: string) {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  return STOCK_POOL.filter(
    (s) =>
      s.ticker.toLowerCase().includes(kw) ||
      s.name.toLowerCase().includes(kw),
  ).slice(0, 20);
}

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
  const revenue = e0 * (3 + (seed % 10));
  const bookValue = e0 * (2 + (seed % 8));

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
