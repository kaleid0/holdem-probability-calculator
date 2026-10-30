# 德州扑克概率计算器

中文 Web App：手动输入手牌、公共牌、对手与底池，计算摊牌胜率、平局概率、底池权益和跟注赔率。

前端 **React + TypeScript + Vite**，后端 **Python + FastAPI**，后端依赖与运行环境统一由 **uv** 管理。

## 本地运行

需要 Python 3.11、uv、Node.js 22 和 pnpm。依赖版本分别锁定在 `backend/uv.lock`、`frontend/pnpm-lock.yaml`。

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

## 第一版功能

- 我的两张手牌、0/3/4/5 张公共牌及已知死牌；选牌时排除已使用的牌。
- 2–9 人，对手支持随机手牌或指定两张手牌。
- 小状态空间精确枚举，大状态空间蒙特卡洛；支持样本预算与随机种子。
- 独赢、平局、输牌概率及考虑多人平分的底池权益。
- 单底池赔率、盈亏平衡权益、限定条件下的跟注 EV。
- 异步计算任务、进度查询、取消及结果过期提示。
- 本地场景保存与 JSON 导入导出。
- 策略注册接口，首个策略为底池赔率分析；后续可添加翻前表、规则与行动模拟策略。

可以导入 `examples/three-way-split.json` 体验公共牌皇家同花顺的三人平局：每人权益为 33.33%，独赢概率为 0。

## 结果如何解释

**独赢概率**表示独自获胜的机会。**权益 Equity**表示平均获得的底池份额；三人平局时每人获得 1/3，不能统一计为半胜。

对手未知时，结果以用户选择的对手模型为条件。默认随机手牌并不代表对真实对手行为的推断。模拟误差只描述抽样误差，不包括范围假设的误差。

`P` 为当前底池，包含对手已下注的金额，不包含这次需要追加的跟注额 `C`：

```text
底池赔率 = P:C
盈亏平衡权益 = C/(P+C)
跟注 EV = Equity × (P+C) − C
```

EV 公式用于无抽水、无边池、跟注后无额外投入并发完公共牌的情况。未来仍可下注时，只能将其作为直接摊牌假设下的参考。第一版不计算边池、锦标赛 ICM、弃牌率或最优加注尺度。

## 项目结构

```text
frontend/                  React 界面、表单、API 客户端、本地场景
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
pnpm --dir frontend test
pnpm --dir frontend build

# 后端服务运行时执行真实 HTTP 集成检查
uv run --project backend python scripts/smoke_api.py
```

新增策略时，实现后端策略合约，注册策略元信息和配置模型，并添加能力检查与合约测试。需要的位置、历史、收益目标等信息不足时应明确返回，不用默认值伪造完整场景。

## 本轮验证

在 Windows 中文工作目录完成：后端 27 项测试、前端 12 项测试、类型检查、后端 Ruff 检查、生产构建、OpenAPI 快照及生成类型一致性检查。真实 HTTP 冒烟覆盖多人平分、随机对手精确枚举、非法输入和 EV 边界；浏览器完成示例计算、重复牌禁选、旧结果提示、JSON 导入、本地保存及桌面/手机布局检查。统一启动器已验证启动和 Ctrl+C 关闭两个服务。

开发依赖目前有上游测试客户端弃用提示，构建有 Zod 注释处理提示；两者均未导致测试或构建失败。预览服务验收结束后已停止，使用上方命令即可重新启动。
