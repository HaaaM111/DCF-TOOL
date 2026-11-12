export type PeerCandidate = { ticker: string; name: string; reason: string };

const kobodaPeers: PeerCandidate[] = [
  { ticker: "002920.SZ", name: "德赛西威", reason: "智能座舱及驾驶域控制器" },
  { ticker: "002906.SZ", name: "华阳集团", reason: "汽车电子及智能座舱" },
  { ticker: "600699.SH", name: "均胜电子", reason: "汽车电子及智能化系统，另有汽车安全业务" },
];

export const isMainlandTicker = (ticker: string) => /^(\d{6}\.(SH|SZ))$/.test(ticker);
export const normalizeIndustry = (industry: string) => industry.normalize("NFKC").trim().replace(/\s+/g, "");

export function mainlandCloseWindow(now: Date) {
  const [date, time] = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short", hourCycle: "h23",
  }).format(now).split(" ");
  const day = Date.parse(date);
  const end = time < "15:00" ? day - 86400000 : day;
  return { start: new Date(end - 10 * 86400000).toISOString().slice(0, 10), end: new Date(end).toISOString().slice(0, 10) };
}

export function selectPeerCandidates(subject: { ticker: string; industry: string }, pool: {
  ticker: string; name: string; industry: string;
}[]) {
  const ticker = subject.ticker.toUpperCase();
  if (ticker === "603786.SH") return kobodaPeers;
  const industry = normalizeIndustry(subject.industry);
  if (!industry || !isMainlandTicker(ticker)) return [];
  const selected = new Map<string, PeerCandidate>();
  for (const peer of pool) {
    const peerTicker = peer.ticker.toUpperCase();
    if (peerTicker !== ticker && isMainlandTicker(peerTicker)
      && normalizeIndustry(peer.industry) === industry && !selected.has(peerTicker)) {
      selected.set(peerTicker, { ticker: peerTicker, name: peer.name, reason: `同一细分行业：${industry}` });
    }
  }
  return [...selected.values()].slice(0, 6);
}
