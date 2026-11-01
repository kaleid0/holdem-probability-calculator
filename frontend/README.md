# 前端开发约定

在项目根目录执行以下命令；Node 与 pnpm 版本分别以根目录 `.node-version` 和本目录 `package.json` 的 `packageManager` 为准。

```powershell
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend check
pnpm --dir frontend test:e2e
```

Windows 已安装 Edge 时，浏览器测试前设置 `$env:PLAYWRIGHT_CHANNEL = 'msedge'`。其他环境先安装 Playwright Chromium。测试会复用已有服务或启动所需服务。

`check` 按顺序执行只读格式检查、ESLint、Vitest 和生产构建。构建包含 TypeScript 检查，避免重复执行同一检查。只运行类型检查可使用 `typecheck`，主动格式化使用 `format`。生成类型、锁文件和构建/测试产物不参与 Prettier 检查。

## 目录与职责

| 路径                                                    | 职责                                       |
| ------------------------------------------------------- | ------------------------------------------ |
| `src/App.tsx`、`src/App.module.css`                     | 页面组装、公共提示与应用外壳               |
| `src/app/`                                              | 工作台导航、面板可见性和吸顶布局           |
| `src/features/scenario/`                                | 局面录入与场景文件操作                     |
| `src/features/analysis/`                                | 快速/精细任务、分析设置、结果与策略比较    |
| `src/features/opponents/`                               | 对手信息、范围矩阵和范围输入               |
| `src/features/live/`                                    | 逐步行动记录与本手结算                     |
| `src/features/table/`                                   | 牌桌设置与筹码账本                         |
| `src/shared/cards/`                                     | 扑克牌、选牌器、选牌类型和交互             |
| `src/shared/ui/Shared.module.css`                       | 复用的面板、按钮、说明、提示及相关状态样式 |
| `src/api/`                                              | HTTP 错误处理及 OpenAPI 生成类型           |
| `src/model.ts`、`src/session*.ts`、`src/liveGame.ts` 等 | 数据校验、纯业务规则、会话与存储           |

组件专属 CSS 与所属功能放在一起，响应式规则随样式一起维护。组件通过自己的 CSS Module 和共享 UI Module 组合样式，不引用 `App.module.css`。领域规则保持独立，避免因为目录整理而让领域模块反向依赖展示组件。

## 状态与任务边界

- 牌局状态由现有 Context 和 session reducer 维护；计算所需数据从同一份牌局派生。
- 导航状态只影响展示，不提交牌局动作、不清除撤销历史。隐藏面板保持挂载，以保留未应用的输入和赢家勾选。
- 快速分析自动运行，过时任务会取消；精细分析手动运行，保留旧结果并按提交输入判断是否过期。两者的任务 hooks 在切换面板时持续存在。
- 更改 effect 依赖时检查任务提交、轮询和清理的生命周期。ESLint 将 Hooks 调用规则和依赖遗漏都视为错误。
- `shared/cards` 提供公用选牌类型，其他组件不从应用入口反向导入类型。

## 接口与 CI

后端模型是接口事实来源。变更接口后，在项目根目录执行：

```powershell
uv run --project backend python scripts/export_openapi.py
pnpm --dir frontend api:generate
```

生成文件不手工编辑。CI 保留后端契约快照检查和生成类型差异检查，再执行 `check`；浏览器回归在独立作业执行。CI 使用与本地相同的 Node/pnpm 版本来源，安装使用冻结锁文件。

pnpm 的 CI 版本通过 [`pnpm/action-setup` 的 `package_json_file` 输入](https://github.com/pnpm/action-setup/tree/v4#inputs)读取，避免工作流里再维护一份版本号。
