# 河牌实验室 · 德州扑克概率计算器 v0.2

中文 Web App：手动输入手牌、公共牌、对手与底池，计算摊牌胜率、平局概率、底池权益和跟注赔率。

前端 **React + TypeScript + Vite**，后端 **Python + FastAPI**，后端依赖与运行环境统一由 **uv** 管理。

## 本地运行

需要 Python 3.11、uv、Node.js 22.17.0 和 pnpm 12.16.1。Node 版本记录在 `.node-version`，pnpm 版本由 `frontend/package.json` 的 `packageManager` 固定；CI 读取同一份配置。依赖版本分别锁定在 `backend/uv.lock`、`frontend/pnpm-lock.yaml`。如需安装指定版本的 pnpm，可运行 `npm install --global pnpm@12.16.1`。

在项目根目录运行：

```powershell
uv sync --project backend --locked
pnpm --dir frontend install --frozen-lockfile
uv run --project backend python scripts/dev.py
```

打开 <http://127.0.0.1:5173>。接口文档位于 <http://127.0.0.1:8000/docs>。统一启动器按 `Ctrl+C` 关闭前后端；端口被占用时会提示，不会终止已有服务。

也可以在两个终端分别启动，便于开发时自动重载：

```powershell
# 终端 1，项目根目录
uv run --project backend uvicorn poker_calculator.api.main:app --app-dir backend/src --reload --host 127.0.0.1 --port 8000

# 终端 2，项目根目录
pnpm --dir frontend dev --host 127.0.0.1 --port 5173 --strictPort
```

前端通过 Vite 代理调用 `/api`，无需配置跨域。第一版为本地开发程序；生产部署需用同源反向代理提供前端及 `/api`，并为公开服务配置身份、配额与共享任务存储。

## 当前功能

工作台通过底部整屏固定导航 Bar 切换“当前牌局 / 对手与范围 / 精细分析 / 牌桌与筹码”。快速分析保留在内容最上方并吸顶显示；当前牌局内保留“局面录入 / 逐步记录”。执行精细分析或点击“查看结果”会进入分析面板。浏览其他面板时，输入草稿、行动历史、进行中的计算和已完成结果保持保留。刷新默认回到当前牌局，并恢复已保存的录入模式与牌局。分批重构记录见 [前端重构实施记录](docs/FRONTEND_REFACTOR.md)。

- 我的两张手牌、0/3/4/5 张公共牌及已知死牌；选牌时排除已使用的牌。
- 2–9 人，对手支持随机手牌、指定两张手牌及加权范围。
- 小状态空间精确枚举，大状态空间蒙特卡洛；支持样本预算与随机种子。
- 独赢、平局、输牌概率及考虑多人平分的底池权益。
- 快速分析固定执行 10,000 次蒙特卡洛模拟，选牌、下注、弃牌和撤销后自动更新；输入未完整时等待补齐，旧任务自动取消。
- 精细分析由用户手动执行，可自行选择模拟精度和高级策略；修改局面后保留结果并标记过期。
- 单底池赔率、盈亏平衡权益、限定条件下的跟注 EV。
- 异步计算任务、进度查询、取消及结果过期提示。
- 本地场景保存与 JSON 导入导出。
- 逐步记录会在每次操作后立即保存完整牌局、当前行动位置、撤销历史和录入模式；手机熄屏导致页面重载或重新打开同一站点时可继续当前一手。
- 玩家行动使用有序结构化事件保存，包含动作、金额、底池与决策上下文；支持按玩家读取序列，详见 [行动序列数据说明](docs/HAND_HISTORY.md)。
- 牌桌设置可分别保存每位玩家的初始筹码（默认每人 1,000），显示剩余筹码、累计盈亏与每手结余；结算后的余额自动带入下一手，刷新和撤销同步恢复筹码账本。
- 逐步记录按实际筹码限制跟注和加注，支持全下、主池/边池、未跟注金额退回及多人平分。其他人均弃牌时自动结算；摊牌后须逐池确认实际赢家，再开始下一手。权益与跟注 EV 分析仍采用单底池模型。
- 策略注册接口，支持底池赔率分析和可配置的权益余量规则，并排比较建议、参考 EV 和触发依据。
- 13×13 范围矩阵、文本范围、组合权重、已知牌阻断及有效组合计数。
- 滑块优先的范围输入：总宽度、细分类别和组合权重即时本地预览，不等待网络校验；精确文本折叠在高级选项。

可以导入 `examples/three-way-split.json` 体验公共牌皇家同花顺的三人平局：每人权益为 33.33%，独赢概率为 0。

v0.2 示例 `examples/weighted-comparison.json` 展示 75% 权益的加权范围及双策略比较。范围语法、接口兼容和验收记录见 [v0.2 说明](docs/V0_2.md)。

## 结果如何解释

**独赢概率**表示独自获胜的机会。**权益 Equity**表示平均获得的底池份额；三人平局时每人获得 1/3，不能统一计为半胜。

对手未知时，结果以用户选择的对手模型为条件。默认随机手牌并不代表对真实对手行为的推断。模拟误差只描述抽样误差，不包括范围假设的误差。

`P` 为当前底池，包含对手已下注的金额，不包含这次需要追加的跟注额 `C`：

```text
底池赔率 = P:C
盈亏平衡权益 = C/(P+C)
跟注 EV = Equity × (P+C) − C
```

EV 公式用于无抽水、无边池、跟注后无额外投入并发完公共牌的情况。未来仍可下注时，只能将其作为直接摊牌假设下的参考。当前权益与 EV 分析仍采用单底池模型，不计算锦标赛 ICM、弃牌率或最优加注尺度；逐步记录中的筹码结算支持主池、边池和退回未跟注金额。

## 项目结构

```text
frontend/                  React 界面、表单、API 客户端、本地场景
  src/app/                 工作台导航与面板容器
  src/features/            scenario、analysis、opponents、live、table 及各自样式
  src/shared/              选牌组件及共享界面样式
  src/api/generated/       从 OpenAPI 生成的类型
  README.md                前端模块边界与检查约定
backend/
  pyproject.toml           Python 依赖与开发工具配置
  uv.lock                  uv 锁文件
  src/poker_calculator/
    api/                   HTTP 路由与 Pydantic 模型
    application/           分析编排和任务调度
    domain/                扑克规则与标准牌局
    engines/               牌力评估和概率计算
    strategies/            统一策略合约与插件
    infrastructure/        进程池及任务基础设施
  tests/                   后端测试
contracts/openapi.json     后端导出的接口快照
scripts/                   启动、接口导出、集成冒烟检查
PROJECT_DESIGN.md           完整设计与升级路线
```

后端保持模块化单体，CPU 密集任务交给有界进程池；领域核心和策略不依赖 FastAPI。第一版任务记录存于单 API 实例内存中，重启后失效，不能使用多个 Uvicorn worker 分享任务。扩展多实例前应引入共享任务存储与任务队列。

## 接口与开发检查

主要接口：

```text
GET  /health
GET  /api/v1/strategies
POST /api/v1/ranges/preview
POST /api/v1/analyses
GET  /api/v1/analyses/{task_id}
POST /api/v1/analyses/{task_id}/cancel
```

后端 Pydantic 模型为接口事实来源。变更接口后导出契约并生成前端类型：

```powershell
uv run --project backend python scripts/export_openapi.py
pnpm --dir frontend api:generate
```

常用验证命令：

```powershell
uv run --project backend pytest backend/tests
uv run --project backend ruff check backend/src backend/tests
uv run --project backend mypy --config-file backend/pyproject.toml backend/src
uv run --project backend python scripts/export_openapi.py --check
pnpm --dir frontend check

# 只检查格式；主动格式化使用 pnpm --dir frontend format
pnpm --dir frontend format:check

# 后端服务运行时执行真实 HTTP 集成检查
uv run --project backend python scripts/smoke_api.py
```

端到端测试使用 Playwright，自动启动并关闭后端与前端：

```powershell
# Windows 已安装 Edge 时，无需再下载浏览器
$env:PLAYWRIGHT_CHANNEL = 'msedge'
pnpm --dir frontend test:e2e

# 使用 Playwright 自带 Chromium（CI 使用此方式）
Remove-Item Env:PLAYWRIGHT_CHANNEL -ErrorAction SilentlyContinue
pnpm --dir frontend exec playwright install chromium
pnpm --dir frontend test:e2e

# 记录当前机器上的引擎耗时和协作取消延迟
uv run --project backend python scripts/benchmark_v02.py
```

新增策略时，实现后端策略合约，注册策略元信息和配置模型，并添加能力检查与合约测试。需要的位置、历史、收益目标等信息不足时应明确返回，不用默认值伪造完整场景。

## 共同牌桌与牌局录入

牌桌设置位于 Bar 的“牌桌与筹码”面板：人数通过 2–9 人按钮选择，庄位通过座位卡片点选，盲注统一设置。玩家 1 固定为自己，座位顺时针编号。开始记录后锁定牌桌，新一手轮转庄位并保留盲注。

“局面录入”和“逐步记录”共用同一份手牌、公共牌、玩家状态与底池。对手范围及分析策略也共用；逐步记录执行精细分析后进入分析面板，返回当前牌局时保留原来的行动位置和录入模式。弃牌保留座位及已投入筹码，权益计算仅包含在局玩家；明确知道的弃牌手牌作为死牌排除。

实验性可视化牌桌：在“逐步记录”中开始记录新一手，点击“可视化牌桌”。支持 2–9 人座位、庄家与大小盲标记、剩余筹码、本轮与累计投入、当前行动者及本轮最近行动，牌桌中央展示底池和公共牌。可直接选取手牌与待发的公共牌，下方继续记录跟注、加注、弃牌和结算；切回“列表视图”或撤销时共用同一份牌局状态。未知底牌显示牌背。手机使用紧凑牌桌，玩家座位显示本轮下注金额（含盲注，换街清零），点击座位查看剩余筹码、完整投入及底牌，“跟随行动”会自动展示当前行动者的详情；大额下注在座位上按万、亿缩写，详情保留完整金额。默认仍为列表视图。

直接修改牌面、阶段、底池或在局状态后，原行动记录失效，当前局面仍可分析。手工录入及导入的局面不会自动补造历史；切换到逐步记录时会说明缺少历史，可从新一手开始记录。浏览器刷新恢复已保存的当前牌局、行动位置、录入模式和撤销历史，导航默认回到当前牌局。

场景保存格式升级为 v3，保存牌桌设置和各座位的在局状态；仍可导入 v1/v2 场景。导出的文件用于恢复当前局面，不包含整手行动日志。

最新本地验证：前端 52 项单元测试、21 项浏览器端到端场景、格式检查、ESLint（含 Hooks 规则）及生产构建通过；后端 64 项测试、Ruff、mypy 和接口契约同步通过。远程 CI 配置已更新，尚未在本轮触发。分批改动与验收详见 [前端重构实施记录](docs/FRONTEND_REFACTOR.md)。

## v0.2 初始验证记录

已通过后端 62 项测试；滑块改进后前端为 20 项测试、5 项真实浏览器端到端测试，类型检查、ESLint 和生产构建正常。新增测试覆盖即时预览、滑块拖动和恢复、快速连续点选；此前已验证加权联合分布、共享缓存与进度、策略部分失败、取消/超时保留已完成结果、v1 场景迁移和手机矩阵。

本地性能观测及限制见 [v0.2 说明](docs/V0_2.md)。CI 已增加浏览器测试作业，远程流水线尚未执行。测试服务会自动清理，使用本地运行命令即可启动应用。

## v0.1 验证记录

在 Windows 中文工作目录完成：后端 27 项测试、前端 12 项测试、类型检查、后端 Ruff 检查、生产构建、OpenAPI 快照及生成类型一致性检查。真实 HTTP 冒烟覆盖多人平分、随机对手精确枚举、非法输入和 EV 边界；浏览器完成示例计算、重复牌禁选、旧结果提示、JSON 导入、本地保存及桌面/手机布局检查。统一启动器已验证启动和 Ctrl+C 关闭两个服务。

开发依赖目前有上游测试客户端弃用提示，构建有 Zod 注释处理提示；两者均未导致测试或构建失败。如预览服务未运行，使用上方本地运行命令启动。
