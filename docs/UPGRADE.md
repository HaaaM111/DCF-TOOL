**增量升级说明｜2026-11-10**

本次保留 Next.js/TypeScript/Prisma 全栈和已有股东回报计算口径。供应商凭据由部署环境提供，GitHub 仅保存 `.env.example` 模板。

**安全与兼容升级**

- Next.js 14 → 16.4.6、React 19、AI SDK 7；原版本及初选SDK版本线有安全公告，因此升级对应依赖和异步Route参数。Node要求≥22。
- 当前登录方式为多用户邮箱密码登录：`src/middleware.ts` 保护内部页面，API 通过 `src/lib/api.ts` 校验数据库会话。浏览器入口是 `/sign-in`，注册入口是 `/sign-up`；登录成功后使用 HttpOnly Cookie `vi_session`，不再使用固定 `admin` 用户名、Basic Auth 或单用户 HMAC 会话，也不需要 `APP_SESSION_SECRET`。生产必须使用 HTTPS，本地 HTTP 预览可按需设置 `ALLOW_INSECURE_COOKIE=true`。
- `src/lib/security/urls.ts`：HTTPS精确主机白名单、DNS地址检查和连接地址固定、禁止重定向及私网请求。新增提供商由服务器`LLM_ALLOWED_HOSTS`配置，文档主机单独配置。
- `src/lib/llm-gateway.ts`：凭据与端点整组选择、默认30秒超时、统一服务不可用降级，支持`LLM_MODEL_NAME`；不显示reasoning_content，不透传供应商错误体。
- `src/lib/request-schema.ts`和端点schema：Zod、请求体上限、路径/查询/文本/列表限制及危险属性拒绝。配置保存保留未提交字段，变更端点要求新密钥，事务写入。
- 补充指标、运行轨迹和扩展估值结果复用现有 AppSetting JSON 存储，避免为这些业务字段额外迁移；旧 ValidationResult 有效记录继续兼容写入。多用户认证模型仍按下述步骤同步用户库 schema。

### 登录与 App Shell 验收

在当前工作树设置本地 `.env.local`，保留既有 SQLite 路径并填写已轮换的 LLM 密钥；不要覆盖已有配置。运行 `npm run dev`，打开 `http://localhost:3000/sign-in`。本地 HTTP 预览需要接收 Cookie 时设置 `ALLOW_INSECURE_COOKIE=true`，生产入口使用 HTTPS 且保持该值为 `false` 或留空。

- 未登录打开 `/dashboard` 等内部路径应跳转到 `/sign-in?next=/dashboard`，认证后返回原路径；邮箱或密码错误应显示表单错误。
- 普通用户从 `/sign-up` 注册，注册后进入 `/home`。管理员通过 `npx tsx scripts/provision-admin.ts <email>` 创建或提升账户，再使用输出的一次性 `/admin-setup?token=...` 链接设置至少 10 位密码；不要把固定 `admin` 当作当前登录账号。
- 登录使用 scrypt 密码哈希和 SQLite 持久化会话。`vi_session` 为 HttpOnly、SameSite=Lax Cookie，生产默认 Secure，会话有效期 30 天；退出后会话记录删除。
- 旧版无账号归属的公司记录继续保留，但不会自动转给新用户。升级前必须备份 `user.db`，并同步多用户模型。
- 看板左侧导航应可在 240 与 64 像素之间切换。窄屏保留图标栏，并可打开导航抽屉；「详情」进入标的报告，横向页签可切换估值摘要、估值模型、敏感性分析、同行对比、AI 归因和复盘记录。
- 在账户菜单退出后，再访问内部页面应返回登录页；调用受保护的 API 会收到 401。

Windows 部署健康检查不再发送 Basic Auth。私有配置可同时提供 `HEALTHCHECK_EMAIL` 和 `HEALTHCHECK_PASSWORD`，脚本通过 `/api/auth/sign-in` 获取 `vi_session` 后执行认证探针并在结束后注销；建议使用管理员账户以核对全库公司数。两者都省略时仍检查服务、匿名 401、登录跳转和登录页，不阻碍发布，但会跳过行情、新闻、页面和估值等认证探针。

**智能体模块**

`src/lib/agent/{schemas,roles,tools,route-handler,grounding,document-tool}.ts`；入口仍是`src/app/api/agent/chat/route.ts`，前端是`src/app/(terminal)/agent/page.tsx`。

假设分析师先读取后端工具观察，只输出结构化审视与证据缺口。估值执行者使用AI SDK工具循环，默认5轮、最大10轮、单次LLM默认30秒、运行预算90秒，支持取消。工具参数经Zod校验，估值使用绑定公司的已保存参数，不允许模型改写基础数据。用户最新问题已修复为实际发送给后端。

工具：`get_financial_context`、`calculate_dcf`、`relative_valuation`、`monte_carlo`、`sensitivity_analysis`、`parse_financial_document`（实验性），以及已有公告同步和分析。多工具结果由SDK按callId配对。前端读取SDK UI消息流，显示工具脉冲和逐段文本。内部推理不展示。

所有数值必须来自工具观察。提示词限定信息来源，输出数字经过观察值/显示舍入白名单检查。该检查只能拦截未观察数字，不能证明每句解释的因果关系；估值仍需人工复核。运行轨迹按`agent_run:<runId>`保存，不含凭据。

多模态工具需要明确配置`VISION_MODEL_NAME`且提供商确实支持对应图像/PDF输入；否则返回实验性不可用。文档有主机白名单、MIME/文件头与10MB下载限制。结构化字段保留页码、期间、单位、证据和置信度，不自动写入正式财务数据。PDF能力依赖模型和供应商文件接口，尚未完成真实供应商联调。

**算法模块**

- `src/lib/jump-simulation.ts`：基础随机参数加可选逐年复合泊松现金流跳跃。λ单位为每年，跳跃幅度为对数均值/标准差；不做漂移补偿，是未校准压力情景。保持配对基础采样，分别输出base/jump P5/P95、固定种子、拒绝样本数；保留负股权价值。只运行必要的forward计算。
- `src/lib/relative-multiples.ts`：PE/PB/PS和EV/Revenue、EV/EBITDA、EV/EBIT；每种输出均值、中位数、有效同行数、股权价值桥接及缺失状态。至少三家有效同行；中位数作为主口径。
- `src/lib/financial-metrics.ts`、`src/app/api/companies/[id]/metrics/route.ts`、`src/components/supplemental-financials.tsx`：编辑已有公司时可录入带报告期和来源的EBIT/EBITDA，人民币亿元，留空表示缺失。同业期间不匹配时不使用其补充指标，不从净利润或CFO推造EBITDA。
- `src/lib/valuation-service.ts`：复用已有同行取数，剔除mock与不完整数据；数据不足不再返回“一致”。历史为空时前端不将默认中性分位显示为真实观测。真实同行的币种、报告期和会计口径仍需使用者复核。
- `src/lib/dcf.ts`：非法Ke≤g拒绝；ExitPE镜像使用`g + FCF20×payoutRate2×(1+g)/(terminalProfitEst×ExitPE)`，相对Ke偏差超过10%即警示“请校准 Ke 或 Exit PE”；市场隐含Ke保留为另一诊断。
- `src/lib/assumption-review.ts`：额外计算基于用户Ke、账面债务和市场股权权重的WACC诊断。现有派现/留存股东模型继续使用Ke，未擅自改成FCFF模型。
- 确定性交叉验证先返回，AI归因单独`/api/validation/attribution`请求，不阻塞蒙特卡洛和图表；归因仅解释已有计算结果和缺口。

**UI模块**

默认暗色并保留浅色选择，采用终端色板和本地 Geist Mono。报告页提供五项 KPI、终值占比、跳跃控制与分布对照、多倍数表格。解构数值来自计算结果，收益文案随正负变化。表格默认显示核心列，展开行显示其他指标，小屏采用卡片化行。图表以 95% 视觉缩放加载，卡片采用阻尼弹簧位移，均支持减少动效偏好。Nginx 关闭流缓冲并延长读取超时。

**本地启动与验证**

使用Node≥22，先备份已有数据库，再在项目根目录执行：

```powershell
npm ci --ignore-scripts
npx prisma generate --schema prisma/schema.prisma
npx prisma generate --schema prisma/schema-base.prisma
# 升级已有用户库前先备份；首次初始化用户库也执行此步
npx prisma db push --schema prisma/schema.prisma
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm run dev
```

复制`.env.example`为`.env.local`，填写两套数据库真实路径和已轮换的 LLM 密钥；不要覆盖已有配置。当前认证不再依赖 `APP_ACCESS_PASSWORD` 或 `APP_SESSION_SECRET`，账户密码由注册/初始化流程写入数据库。首建空 SQLite 数据库时，当前 Windows Prisma 可能需先创建空文件；用户库执行上述 `db push`，首次初始化基准库时再按需执行 `npx prisma db push --schema prisma/schema-base.prisma`。本次用户库新增多用户、会话和账号归属模型，升级已有 `user.db` 前必须备份并同步 schema，不要重建或丢弃旧库。

预期：未登录生产接口 401，内部页面跳转 `/sign-in` 并保留 `next`；非法参数 422；未配置模型时局部提示服务不可用；报告页能独立完成估值、模拟和敏感性计算；调整 ExitPE 会改变镜像警示；λ=0 时基础/跳跃分位数一致；EBITDA 缺失时对应倍数显示数据不足。

自动测试覆盖金融边界、安全校验、SDK 五轮终止、多工具配对与 UI 消息协议。2026-11-11 的服务器隔离预览已完成真实 iFinD 财务接口、讯飞固定提示词，以及纯虚构标的的双角色交接、DCF 工具执行和流式输出联调。视觉模型尚未配置，其工具返回实验性不可用。多模态提取精度与因果解释质量仍需专项评估。

### Windows 正式发布、备份与回滚

Windows 正式发布使用 `deploy/windows-release.ps1`。在本机构建 standalone 包，在服务器按 Git 提交创建版本目录，保留 SQLite 文件路径并切换既有 NSSM 服务。应用只绑定 `127.0.0.1:3000`，浏览器入口使用既有 HTTPS 反向代理；已确认的 SSH 隧道方案仅作为运维访问方式，不替代登录认证或生产 HTTPS 要求。

在本机项目根目录执行：

```powershell
$env:NEXT_BUILD_DIR = '.next-standalone'
npm run build
node scripts/package-windows-release.mjs <40位提交SHA> .next-standalone
New-Item -ItemType Directory -Path 'C:\valueinsight-artifacts' -Force | Out-Null
Compress-Archive -Path '.release-windows\*' -DestinationPath 'C:\valueinsight-artifacts\release.zip' -Force
Get-FileHash 'C:\valueinsight-artifacts\release.zip' -Algorithm SHA256
```

产物目录为已忽略的 `.release-windows`，压缩包内必须直接包含 `server.js` 等产物，不能多套一层目录。包内不得包含 `.env*` 或数据库文件；发布脚本还会校验压缩包 SHA-256、拒绝危险路径/环境文件/数据库条目、限制版本目录 ACL，并检查提交、构建 ID、便携 Node 和 Prisma 引擎。

发布前先按“本地启动与验证”中的步骤完成生产 `user.db` 备份、双 Prisma 生成和用户库 `db push`；发布脚本不会代替数据库迁移。服务器私有配置必须显式引用生产数据库，脚本才会继续，例如：

```dotenv
DATABASE_URL=file:C:/valueinsight/prisma/user.db
BASELINE_DATABASE_URL=file:C:/valueinsight/prisma/baseline.db?mode=ro
```

同时填写实际 LLM 凭据；可选 `HEALTHCHECK_EMAIL`/`HEALTHCHECK_PASSWORD` 用于认证健康检查，二者必须同时设置或同时省略。配置写入版本目录的 `.env.local` 后仅授予管理员和 SYSTEM 完全控制权限。以管理员 PowerShell 运行：

```powershell
.\deploy\windows-release.ps1 -Commit <40位提交SHA> -ExpectedSha256 <64位SHA256> `
  -Archive 'C:\valueinsight-artifacts\release.zip' `
  -ConfigurationFile 'C:\valueinsight-private\release.env' `
  -PublicOrigin 'https://valueinsight.example.com'
```

`-ProductionRoot`、`-ReleaseRoot` 和 `-ServiceName` 可按现有安装调整。默认要求服务正在运行；仅在确认要从停止状态恢复发布时添加 `-RecoverStoppedService`。

**备份校验**

- 切换 NSSM 前停止原服务并备份 `user.db`、`baseline.db`；同时对源库和备份副本执行 SQLite `PRAGMA quick_check`。
- 对存在的 `Company`、`Assumption`、`ValuationReport` 表记录数进行源库/副本比对，重新打开副本校验，并拒绝空文件。
- 生成 `deployment-state/database-counts.json` 和 `backup-manifest.json`，清单记录验证时间、文件名、字节数和 SHA-256；PowerShell 会再次核对清单条目、文件大小及实际哈希，全部通过后才切换服务。
- 服务参数同时导出为 `service-parameters.reg` 和 `previous-service.json`，保存在 `<ReleaseRoot>\<Commit>\deployment-state`；成功结果中的 `backups` 和 `backupManifest` 指向这些文件。

**健康检查与回滚**

认证探针使用 `/api/auth/sign-in` 和 `vi_session`，不发送 Basic Auth，也不依赖旧 HMAC Cookie。配置健康检查账号时，还会验证匿名 401、行情 401/422、`no-store`、登录跳转、内部页面、新闻来源、行业目录，以及适用标的的行情、DCF、OHLC、模拟、敏感性和归因证据。未配置账号时跳过这些认证探针，但服务可用性、匿名访问控制和登录跳转仍必须通过；随后还要求 3000 端口只有一个 `127.0.0.1` 监听。

备份、NSSM 配置、启动、健康检查或监听校验失败时，脚本会停止新服务、导入原注册表参数，并且仅在发布前服务正在运行时重新启动；使用 `-RecoverStoppedService` 时回滚后保持停止。自动回滚只恢复服务配置，**不会自动覆盖数据库**。如需恢复发布前数据，先停止服务，按 `backup-manifest.json` 重新校验备份，再将两个 `.db` 恢复到原 `prisma` 路径并处理同名 `-wal`/`-shm` 侧文件，保留基准库只读属性；必要时在提升权限的 PowerShell 中执行 `reg.exe import '<ReleaseRoot>\<Commit>\deployment-state\service-parameters.reg'`，确认旧配置后按原状态启动服务。排查完成前不要删除失败版本的 `deployment-state`。

**研究与开源参考**

已只读补读两个项目核心文件，未复制实现或引入Python。AlphaAnalyst的纯函数、输入验证、缺失状态和中位数统计可移植；其CFO代理EBITDA与以CAPM类公式称WACC的近似没有沿用。DCF-Valuation-Platform借鉴取数/计算/API分层；其宽松CORS和默认市场参数没有沿用。

- [AlphaAnalyst dcf](https://github.com/kbhujbal/AlphaAnalyst-open-source-autonomous-equity-research-agent/blob/main/backend/src/modeler/dcf.py)
- [AlphaAnalyst assumptions](https://github.com/kbhujbal/AlphaAnalyst-open-source-autonomous-equity-research-agent/blob/main/backend/src/modeler/assumptions.py)
- [AlphaAnalyst comps](https://github.com/kbhujbal/AlphaAnalyst-open-source-autonomous-equity-research-agent/blob/main/backend/src/modeler/comps.py)
- [DCF-Valuation-Platform model](https://github.com/estebg86/DCF-Valuation-Platform/blob/main/backend/dcf_model.py)
- [DCF-Valuation-Platform API](https://github.com/estebg86/DCF-Valuation-Platform/blob/main/backend/main.py)
- [FinVision](https://arxiv.org/abs/2608.22724)：19%/51%是其研究设置结果，未作为本项目性能承诺。
- [FinDocLLM](https://doi.org/10.1051/shsconf/202623101012)：采用多模态与证据设计思路，不宣称复现训练或评测。

HSE、ACM、新兴市场比较与动效引用仍缺精确书目信息，相关功能按用户明确需求实现，不声称未核实论文已证明本项目效果。
