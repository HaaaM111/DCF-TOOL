import { isMainlandTicker, normalizeIndustry } from "./peer-selection";

type Issuer = { ticker: string; name: string; industry: string };
type ReferenceGroup = { name: string; members: readonly (readonly [string, string])[] };

// Reviewed by business exposure. These research groups do not claim to be index constituents.
const referenceGroups: ReferenceGroup[] = [
  { name: "汽车电子", members: [
    ["603786.SH", "科博达"], ["002920.SZ", "德赛西威"], ["002906.SZ", "华阳集团"], ["600699.SH", "均胜电子"],
  ] },
  { name: "商用客车", members: [
    ["600066.SH", "宇通客车"], ["600686.SH", "金龙汽车"], ["000957.SZ", "中通客车"], ["000868.SZ", "安凯客车"],
  ] },
  { name: "综合乘用车", members: [
    ["600104.SH", "上汽集团"], ["000625.SZ", "长安汽车"], ["601238.SH", "广汽集团"], ["601633.SH", "长城汽车"],
  ] },
  { name: "汽车玻璃", members: [["600660.SH", "福耀玻璃"]] },
  { name: "白酒", members: [
    ["600519.SH", "贵州茅台"], ["000858.SZ", "五粮液"], ["000568.SZ", "泸州老窖"], ["600809.SH", "山西汾酒"],
    ["000596.SZ", "古井贡酒"], ["002304.SZ", "洋河股份"], ["603369.SH", "今世缘"],
  ] },
  { name: "家用白电", members: [
    ["000333.SZ", "美的集团"], ["000651.SZ", "格力电器"], ["600690.SH", "海尔智家"], ["000921.SZ", "海信家电"],
  ] },
  { name: "银行", members: [
    ["600036.SH", "招商银行"], ["601166.SH", "兴业银行"], ["600000.SH", "浦发银行"], ["000001.SZ", "平安银行"],
    ["601398.SH", "工商银行"], ["601939.SH", "建设银行"], ["601288.SH", "农业银行"], ["601988.SH", "中国银行"],
  ] },
  { name: "工程机械", members: [
    ["600031.SH", "三一重工"], ["000157.SZ", "中联重科"], ["000425.SZ", "徐工机械"], ["000528.SZ", "柳工"],
  ] },
];

const assigned = new Map(referenceGroups.flatMap(({ name, members }) =>
  members.map(([ticker, memberName]) => [ticker, { ticker, name: memberName, industry: name }] as const)));
const broadIndustry = new Set(["汽车整车", "汽车零部件", "家电", "金融", "汽车", "制造业"]);
export const isFinancialIndustry = (industry: string) => /银行|保险|证券|金融/.test(industry);

export function industryForIssuer(issuer: Issuer) {
  const ticker = issuer.ticker.toUpperCase();
  if (!isMainlandTicker(ticker)) return null;
  const industry = assigned.get(ticker)?.industry ?? normalizeIndustry(issuer.industry);
  return industry && !broadIndustry.has(industry) ? industry : null;
}

export function industryCatalog(issuers: Issuer[]) {
  const groups = new Map(referenceGroups.map(({ name, members }) =>
    [name, new Map(members.map(([ticker, member]) => [ticker, { ticker, name: member, reason: `研究样本 · ${name}` }]))]));
  for (const issuer of issuers) {
    const industry = industryForIssuer(issuer);
    if (!industry) continue;
    const ticker = issuer.ticker.toUpperCase();
    const members = groups.get(industry) ?? new Map();
    if (!members.has(ticker)) members.set(ticker, { ticker, name: issuer.name, reason: `工作区同一细分行业 · ${industry}` });
    groups.set(industry, members);
  }
  return groups;
}
