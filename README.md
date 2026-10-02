# DCF 预期差挖掘工具

基于 Next.js 14 + Ant Design 的 DCF 估值分析终端，面向 A 股/港股标的的估值穿透与预期差挖掘。

## 功能特性

- **DCF 正向估值**：20 年自由现金流推演 + 终局价值，输出目标价与潜在空间
- **逆向财务穿透**：由市价反算隐含折现率、隐含终局利润、隐含 CAGR
- **四象限诊断**：绿灯双低 / 绿灯预期已装满 / 红灯退出倍数高 / 红灯预期落空
- **蒙特卡洛模拟**：目标价置信区间（P5 / P25 / 中位数 / P75 / P95）
- **估值交叉验证**：绝对估值（DCF）× 相对估值（PE/PB/PS 行业中枢）交叉验证 + AI 归因
- **数据源**：同花顺 iFinD 真实行情与财务数据（未配置 Token 时自动进入 Mock 模式）

## 双库架构

用户使用数据与基准公司档案**物理分离**：

| 数据库 | 内容 | 权限 |
| --- | --- | --- |
| `prisma/baseline.db` | 基准公司档案（财务、行情、行业、估值参数） | **只读** |
| `prisma/user.db` | 用户数据：评估快照、模型假设、估值报告、验证结果、行情快照、时间线、同行对比、历史估值 | 可读写 |

基准库只读采用三层保护：

1. 文件只读属性（Windows 下 `attrib +R`）
2. SQLite 以 `mode=ro` 连接
3. Web 写接口全部返回 403（新增 / 删除 / 导入 / 行情同步）

> `companyId` 为跨库引用（无外键约束），由应用层保证一致性。

## 快速开始

环境要求：Node.js ≥ 18。

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
#    .env.local 填入同花顺 iFinD refresh_token（可选，不填则使用 Mock 数据）
#    首次使用请先初始化种子数据（会通过 iFinD 拉取真实财务数据）
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
| `DATABASE_URL` | 用户库 SQLite 路径 | `.env` / `.env.production` |
| `BASELINE_DATABASE_URL` | 基准库 SQLite 路径（应用运行时带 `mode=ro`） | `.env` / `.env.production` |
| `IFIND_REFRESH_TOKEN` | 同花顺 iFinD refresh_token（**切勿提交**） | `.env.local` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key，用于 AI 归因（可选） | `.env.local` |
| `CORS_ORIGIN` | CORS 白名单 | `.env` / `.env.production` |
| `RATE_LIMIT_PER_MINUTE` | API 速率限制（次/分钟/IP） | `.env` |

`DATABASE_URL` 建议使用相对路径，如 `file:./prisma/user.db`。

## 基准库维护

基准库只读，公司档案的增删改与行情刷新统一通过管理脚本（唯一写入口）：

```bash
# 列出基准公司
npx tsx scripts/manage-baseline.ts list

# 新增公司（company.json 格式：{ "company": {...}, "assumptions": {...} }）
npx tsx scripts/manage-baseline.ts add company.json

# 更新公司档案字段
npx tsx scripts/manage-baseline.ts update <id|ticker> company.json

# 删除公司（同时清理其全部用户数据）
npx tsx scripts/manage-baseline.ts delete <id|ticker>

# 批量导入（文件由 GET /api/export 生成）
npx tsx scripts/manage-baseline.ts import export.json

# 行情同步（拉取最新收盘价，写 PriceSnapshot 并刷新 Company.currentPrice）
npx tsx scripts/manage-baseline.ts sync-market
```

脚本在写入期间临时解除基准库只读属性，完成后自动恢复。

## 数据备份与恢复

- 导出全部标的（公司 + 假设 + 快照）：`GET /api/export`，可直接用于 `manage-baseline.ts import` 恢复
- 数据库文件备份：复制 `prisma/user.db`（用户数据）与 `prisma/baseline.db`（基准数据）
- 历史迁移备份位于 `prisma/backup/`

## 目录结构

```
prisma/
  schema.prisma         # 用户库模型
  schema-base.prisma    # 基准库模型（Company）
  seed.ts               # 种子初始化（iFinD 真实财务）
scripts/
  manage-baseline.ts    # 基准库维护脚本（唯一写入口）
  migrate-split-db.ts   # 单库→双库迁移脚本（一次性）
src/
  app/api/              # Next.js API 路由
  lib/                  # 业务逻辑（dcf / ifind-client / dual-db 等）
  components/           # 图表与验证组件
```

## 安全说明

- `.env` / `.env.local` / 数据库文件 / 生成代码均已在 `.gitignore` 中忽略，不会提交
- iFinD refresh_token 仅服务端读取，绝不暴露给前端
- 用户输入（时间线内容等）入库前做 XSS 转义
