# ValueInsight · DCF 预期差挖掘工具

基于 Next.js 14 + Ant Design 的 DCF 估值分析终端，面向 A 股 / 港股标的的估值穿透与预期差挖掘，内置公告智能体。

## 功能特性

- **DCF 正向估值**：20 年自由现金流推演 + Gordon 终值，输出目标价与潜在空间
- **逆向财务穿透**：由市价反算隐含折现率、隐含终局利润、隐含 CAGR
- **四象限诊断**：绿灯双低 / 绿灯预期已装满 / 红灯退出倍数高 / 红灯预期落空
- **蒙特卡洛模拟**：目标价置信区间（P5 / P25 / 中位数 / P75 / P95）
- **估值交叉验证**：绝对估值（DCF）× 相对估值（PE/PB/PS 行业中枢）+ AI 归因
- **公告智能体**：按需抓取巨潮公告 → 规则分类 → LLM 生成预期差信号与假设修正建议（只出信号，不改假设）
- **数据源**：同花顺 iFinD 真实行情与财务数据，东财免费接口分流兜底；未配置 Token 时自动进入 Mock 模式

## 快速开始

环境要求：Node.js ≥ 18。

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
#    .env.local 填入 iFinD refresh_token（可选，不填则使用 Mock 数据）
#    首次使用先初始化种子数据（会通过 iFinD 拉取真实财务数据）
npx tsx prisma/seed.ts

# 3. 生产模式启动（推荐，秒开）
npm run build
npm run start
# 打开 http://localhost:3000

# 开发模式（每次访问未编译路由会现场编译，较慢，仅开发用）
npm run dev
```

## 环境变量

| 变量 | 说明 | 所在文件 |
| --- | --- | --- |
| `DATABASE_URL` | 用户库 SQLite 路径（建议相对路径 `file:./prisma/user.db`） | `.env` / `.env.production` |
| `BASELINE_DATABASE_URL` | 基准库 SQLite 路径（运行时带 `mode=ro`） | `.env` / `.env.production` |
| `IFIND_REFRESH_TOKEN` | 同花顺 iFinD refresh_token（**切勿提交**） | `.env.local` |
| `IFIND_BASE_URL` / `IFIND_TOKEN_PATH` | iFinD 接口地址与 token 路径 | `.env` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key，用于 AI 归因 / 公告信号（可选） | `.env.local` |
| `LLM_*` | 通用 OpenAI 兼容配置（baseUrl/model/key），优先级高于旧 `DEEPSEEK_*` 变量 | `.env.local` |
| `CORS_ORIGIN` | CORS 白名单（多域名逗号分隔） | `.env` / `.env.production` |
| `RATE_LIMIT_PER_MINUTE` | API 速率限制（次/分钟/IP） | `.env` |
| `MAX_IMPORT_BYTES` | 导入文件大小上限 | `.env` |
| `VERIFY_CALCULATION` | 计算校验开关 | `.env` |

## 双库架构

用户使用数据与基准公司档案**物理分离**：

| 数据库 | 内容 | 权限 |
| --- | --- | --- |
| `prisma/baseline.db` | 基准公司档案（财务、行情、行业、估值参数） | **只读** |
| `prisma/user.db` | 用户数据：评估快照、模型假设、估值报告、验证结果、行情快照、时间线、同行对比、历史估值 | 可读写 |

基准库只读采用三层保护：文件只读属性（`attrib +R`）→ SQLite `mode=ro` 连接 → Web 写接口全部返回 403。

> `companyId` 为跨库引用（无外键约束），由应用层保证一致性。

## 估值计算核心（DCF 引擎）

核心代码：`src/lib/dcf.ts`（计算引擎）、`src/lib/monte-carlo.ts`（模拟）、`src/lib/valuation-validation.ts`（交叉验证）、`src/types/dcf.ts`（类型）。

### baseFcf 的五种候选口径

财务字段来源（iFinD）：归母净利润 `e0`、经营现金流 `cfo`、资本开支 `capex`、折旧摊销 `da`。

| 方案 | 公式 | 大白话 |
| --- | --- | --- |
| 当年实际值（默认） | `CFO − Capex` | 经营赚到的现金 − 投出去的钱 |
| 无派现口径 | `E0 + D&A − Capex` | 净利润加回折旧摊销，剔除偶发 |
| 中位数 | `(实际值 + 无派现口径) / 2` | 平滑异常波动 |
| 剔除金融类后 | `实际值 × 0.73` | 金融子公司现金流约占 27% |
| 剔除营运资本释放后 | `实际值 × 0.69` | 营运资本释放不可持续 |

### 20 年三阶段推演

```
第 1–5 年：增速 g1    第 6–10 年：增速 g2    第 11–20 年：增速 g3
FCF_t = FCF_{t-1} × (1 + g_t)
分红_t = FCF_t × 派现率（1–10 年 payoutRate1，11–20 年 payoutRate2）
留存累积_t = 留存累积_{t-1} × 1.02 + 留存_t   （留存现金按 2% 复利）
```

### 终值与两套估值口径

终值用 **Gordon 永续增长模型**，有防御处理（`Ke ≤ g` 时退化为 50 倍封顶）：

- **口径 A · 股东回报口径（推荐）**：以第 20 年分红为永续起点，`股权价值 = PV(显性期分红) + PV(TV分红) + PV(留存累积) + 净现金`
- **口径 B · 原版 FCF 口径**：以第 20 年 FCF 为永续起点，`股权价值 = PV(20年FCF) + PV(TV_FCF) + 净现金`

折现率直接用股权要求回报率 `Ke`（本系统为股权 DCF，`WACC ≈ Ke`，无债务权重）。

### 逆向 DCF（隐含终局利润 L）

```
隐含终值 = 市值 − 净现金 − PV(显性期)
L = 隐含终值 × (r − g) / (1 + g)
```

衍生指标：`L/E3`（终局利润是第 3 年的几倍）、`L/E0`、隐含 CAGR = (L/E3)^(1/17) − 1、隐含 Ke（与设定 Ke 偏差 ±10% 内视为"自洽"）。

### 蒙特卡洛模拟

对 5 个关键参数正态采样（mulberry32 可复现，种子 42），重跑 10000 次完整 DCF：

| 参数 | 标准差 σ | 截断 |
| --- | --- | --- |
| g1/g2/g3 | max(0.005, \|μ\|×30%) | 不截断 |
| 永续 g | max(0.003, \|μ\|×30%) | [−5%, +5%] |
| Ke | 0.015 | [5%, 30%] |

输出 P5/P25/中位数/P75/P95、均值标准差、`pricePercentile`（市价在分布中的百分位，越高越贵）与直方图。

### 敏感性矩阵与诊断标签

确定性三变量扫描（r 8–12% / ExitPE 5–9 / g −1%~3%）→ 隐含 L；再按规则贴标签：

| 标签 | 条件 |
| --- | --- |
| 绿灯双低·容错增厚 | L/E3 < 30 且 隐含CAGR < 过渡增速 − 5% |
| 绿灯·预期已装满 | L/E3 < 30 且 \|隐含CAGR − 过渡增速\| ≤ 5% |
| 红灯·退出倍数高 | L/E3 ≥ 30 |
| 红灯·预期落空 | 其他 |

叙事分级另有：现金覆盖型（净现金 > 市值）、业务负定价（L/E3 < 0）、高增长透支（L/E3 > 40）、需重审 Ke（Gordon 不自洽）。

## 公告智能体

按需模式：用户对某公司点击"拉取公告并分析" → 从巨潮资讯（cninfo）抓取近 30 天公告 → PDF 文本提取 + 标题规则分类 → LLM 生成结构化信号（超预期/符合/低于 + 建议调整字段）→ 入库展示。**只生成信号，不自动改假设。**

- **数据链路**：`src/lib/announcement/cninfo-client.ts`（巨潮 API）→ `parser.ts`（pdf-parse 提取 + 关键词分类）→ `analyzer.ts`（LLM 信号）→ `sync-service.ts`（共享服务）→ `src/app/api/announcements/*`
- **幂等**：`@@unique([companyId, code])`，重复触发 `added=0`
- **降级**：未配置 LLM Key 时正常入库、`llmReady:false`、信号跳过；扫描件/超大 PDF 只入库不分析；单公告失败不影响整批（`failed` 列表返回）
- **成本控制**：仅规则命中的类别调 LLM；rawText 截断 6000 字符；PDF > 5000KB 跳过
- **依赖注意**：`pdf-parse` 必须钉 **1.1.1**（2.x 为 TS 重写版，导出结构不兼容）；`next.config.mjs` 已将其外部化防打包崩溃
- **实现状态（2026-10-09）**：已端到端验证——格力电器(000651.SZ)、华域汽车(600741.SH) 真实拉取入库，幂等与分类筛选正常
- 备选数据源实测结论：上交所 SSE 接口可用（沪市补充/交叉验证）；深交所 SZSE 按股过滤不可靠，不建议直连，巨潮为主源

## 基准库维护

基准库只读，公司档案增删改与行情刷新统一通过管理脚本（唯一写入口）：

```bash
npx tsx scripts/manage-baseline.ts list              # 列出基准公司
npx tsx scripts/manage-baseline.ts add company.json  # 新增公司（{company, assumptions} 结构）
npx tsx scripts/manage-baseline.ts update <id|ticker> company.json  # 更新档案
npx tsx scripts/manage-baseline.ts delete <id|ticker>               # 删除（级联清理用户数据）
npx tsx scripts/manage-baseline.ts import export.json # 批量导入（文件由 GET /api/export 生成）
npx tsx scripts/manage-baseline.ts sync-market        # 行情同步（写 PriceSnapshot + 刷新现价）
```

脚本写入期间临时解除基准库只读属性，完成后自动恢复。`api/import` 与 `api/cron/sync-market` 已停用，统一走脚本。

## 数据备份与恢复

- 导出全部标的（公司 + 假设 + 快照）：`GET /api/export`，可直接 `import` 恢复
- 数据库文件备份：复制 `prisma/user.db`（用户数据）与 `prisma/baseline.db`（基准数据）
- 历史迁移备份位于 `prisma/backup/`

## 部署（阿里云 ECS）

`deploy/` 目录提供完整部署脚本：

| 文件 | 作用 |
| --- | --- |
| `deploy/init-server.sh` | 服务器首次初始化：Node 20、PM2、Nginx、Git、防火墙、Certbot |
| `deploy/deploy.sh` | 一键部署：拉代码 → 装依赖 → Prisma generate → db push → build → PM2 重启 |
| `deploy/nginx.conf` | Nginx 反代配置：80 端口、安全头、静态缓存、gzip、健康检查 |

生产进程由 PM2 托管（`ecosystem.config.cjs`）：`next start -p 3000`，仅监听 127.0.0.1（公网经 Nginx 反代访问），日志写入 `logs/`。

## 目录结构

```
prisma/
  schema.prisma         # 用户库模型（含 Announcement / AnnouncementSignal）
  schema-base.prisma    # 基准库模型（Company）
  seed.ts               # 种子初始化（iFinD 真实财务）
scripts/
  manage-baseline.ts    # 基准库维护脚本（唯一写入口）
  migrate-split-db.ts   # 单库→双库迁移脚本（一次性）
  sync-initial-companies.ts  # 初始标的同步
src/
  app/api/              # Next.js API 路由（companies / dcf / simulation / validation / ifind / announcements / agent / export）
  app/                  # 页面：dashboard（仪表盘）、model/edit（假设编辑）、report/[id]（报告）、announcements（公告中心）、agent（智能体）
  lib/                  # 业务逻辑：dcf / monte-carlo / valuation-validation / ai-client / ifind-client / eastmoney-client / data-source / dual-db / announcement/
  components/           # 图表与验证组件
  types/dcf.ts          # DCF 类型定义
deploy/                 # ECS 部署脚本
```

## 安全说明

- `.env` / `.env.local` / 数据库文件 / 生成代码均已在 `.gitignore` 中忽略，不会提交
- iFinD refresh_token / LLM API Key 仅服务端读取，前端不回显明文（LLM key 仅显示前后 4 位掩码）
- 用户输入（时间线内容等）入库前做 XSS 转义
- 全站安全响应头：X-Frame-Options DENY（防点击劫持）、nosniff、Referrer-Policy、Permissions-Policy
