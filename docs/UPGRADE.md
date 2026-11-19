**增量升级说明｜2026-11-10**

本次保留 Next.js/TypeScript/Prisma 全栈和已有股东回报计算口径。供应商凭据由部署环境提供，GitHub 仅保存 `.env.example` 模板。

**安全与兼容升级**

- Next.js 14 → 16.4.6、React 19、AI SDK 7；原版本及初选SDK版本线有安全公告，因此升级对应依赖和异步Route参数。Node要求≥22。
- `src/proxy.ts`：浏览器Basic登录，用户名admin，密码由服务端`APP_ACCESS_PASSWORD`设置。生产环境未配置密码返回503；开发环境无密码时配置管理接口关闭。使用HTTPS反代部署。
- `src/lib/security/urls.ts`：HTTPS精确主机白名单、DNS地址检查和连接地址固定、禁止重定向及私网请求。新增提供商由服务器`LLM_ALLOWED_HOSTS`配置，文档主机单独配置。
- `src/lib/llm-gateway.ts`：凭据与端点整组选择、默认30秒超时、统一服务不可用降级，支持`LLM_MODEL_NAME`；不显示reasoning_content，不透传供应商错误体。
- `src/lib/request-schema.ts`和端点schema：Zod、请求体上限、路径/查询/文本/列表限制及危险属性拒绝。配置保存保留未提交字段，变更端点要求新密钥，事务写入。
- 补充指标、运行轨迹和扩展估值结果复用现有AppSetting JSON存储，避免迁移旧SQLite数据库；旧ValidationResult有效记录继续兼容写入。

**智能体模块**

`src/lib/agent/{schemas,roles,tools,route-handler,grounding,document-tool}.ts`；入口仍是`src/app/api/agent/chat/route.ts`，前端仍是`src/app/agent/page.tsx`。

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
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm run dev
```

复制`.env.example`为`.env.local`，填写数据库真实路径、登录密码、已轮换的LLM密钥；不要覆盖已有配置。用户名admin。首建空SQLite数据库时，当前Windows Prisma可能需先创建空文件；升级已有数据库无需db push。本次未改schema，也不需要重建旧库。

预期：未登录生产接口401；缺生产密码503；非法参数422；未配置模型时局部提示服务不可用；报告页能独立完成估值、模拟和敏感性计算；调整ExitPE会改变镜像警示；λ=0时基础/跳跃分位数一致；EBITDA缺失时对应倍数显示数据不足。

自动测试覆盖金融边界、安全校验、SDK 五轮终止、多工具配对与 UI 消息协议。2026-11-11 的服务器隔离预览已完成真实 iFinD 财务接口、讯飞固定提示词，以及纯虚构标的的双角色交接、DCF 工具执行和流式输出联调。视觉模型尚未配置，其工具返回实验性不可用。多模态提取精度与因果解释质量仍需专项评估。

Windows 正式发布使用 `deploy/windows-release.ps1`。在本机构建 standalone 包，在服务器按 Git 提交创建版本目录，保留 SQLite 文件路径，切换既有 NSSM 服务。脚本在切换前备份两套数据库和服务配置，健康检查失败时恢复原服务配置。应用绑定回环地址，按已确认的 SSH 隧道方案访问。包内必须排除 `.env*` 和数据库文件，配置通过服务器私有文件提供。

Windows 打包命令为 `node scripts/package-windows-release.mjs <40位提交SHA> .next-standalone`，构建时设置 `NEXT_BUILD_DIR=.next-standalone`。在项目根目录运行，产物写入已忽略的 `.release-windows`。服务器发布脚本接收提交 SHA、压缩包 SHA256、压缩包路径和私有配置文件路径，运行环境为管理员 PowerShell 与已有 NSSM 服务。

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
