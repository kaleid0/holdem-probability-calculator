import { useEffect, useRef, useState } from "react";
import { useScenario } from "./state";
import type { Draft } from "./model";
import s from "./App.module.css";
import ui from "./shared/ui/Shared.module.css";
import LiveTable from "./features/live/LiveTable";
import TableSettings from "./features/table/TableSettings";
import AnalysisSettings from "./features/analysis/AnalysisSettings";
import OpponentSettings from "./features/opponents/OpponentSettings";
import QuickAnalysis from "./features/analysis/QuickAnalysis";
import QuickAnalysisDetails from "./features/analysis/QuickAnalysisDetails";
import { useQuickAnalysis } from "./features/analysis/useQuickAnalysis";
import { Card } from "./shared/cards/Card";
import { CardPicker } from "./shared/cards/CardPicker";
import { useCardSelection } from "./shared/cards/useCardSelection";
import { useStrategies } from "./features/analysis/useStrategies";
import { useDetailedAnalysis } from "./features/analysis/useDetailedAnalysis";
import { useScenarioFiles } from "./features/scenario/useScenarioFiles";
import ScenarioPanel from "./features/scenario/ScenarioPanel";
import AnalysisPanel from "./features/analysis/AnalysisPanel";
import WorkspaceBar from "./app/WorkspaceBar";
import type { WorkspaceTab } from "./app/WorkspaceBar";
import WorkspacePanel from "./app/WorkspacePanel";
import w from "./app/Workspace.module.css";

export default function App() {
  const { draft, game, dispatch, mode } = useScenario();
  const setMode = (mode: "snapshot" | "live") =>
    dispatch({ type: "mode", mode });
  const [activePanel, setActivePanel] = useState<WorkspaceTab>("scenario");
  const workspace = useRef<HTMLDivElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const selectPanel = (next: WorkspaceTab) => {
    setActivePanel(next);
    setPicker(null);
    requestAnimationFrame(() =>
      workspace.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      }),
    );
  };
  const showAnalysis = () => {
    selectPanel("analysis");
    requestAnimationFrame(() =>
      resultPanel.current?.focus({ preventScroll: true }),
    );
  };
  const resultPanel = useRef<HTMLElement>(null);
  const {
    strategies,
    connection,
    connectionAttempt,
    retryConnection,
    markOnline,
  } = useStrategies();
  const quickAnalysis = useQuickAnalysis(connectionAttempt);
  const analysis = useDetailedAnalysis(() => {
    setMessage("");
    showAnalysis();
  }, markOnline);
  const { errors, setErrors, busy, calculate } = analysis;
  const files = useScenarioFiles(setErrors);
  const { message, setMessage, exportScene } = files;
  const patch = (value: Partial<Draft>) => {
    dispatch({ type: "patch", patch: value });
    setErrors([]);
    setMessage("");
  };
  const { picker, setPicker, setCard } = useCardSelection(draft, patch);
  useEffect(() => {
    if (!errors.length) return;
    notice.current?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [errors]);
  const taskStatus = busy
    ? analysis.task?.status === "cancelling"
      ? "取消中"
      : "计算中"
    : analysis.task?.status === "failed"
      ? "失败"
      : analysis.task?.status === "cancelled"
        ? "已取消"
        : analysis.task?.status === "expired"
          ? "已失效"
          : analysis.completed
            ? analysis.completed.input === analysis.fingerprint
              ? "已完成"
              : "待更新"
            : "";

  return (
    <div className={s.app}>
      <header className={s.header}>
        <a href="#" className={s.brand} aria-label="河牌实验室首页">
          <span className={s.brandIcon}>♠</span>
          <span>
            河牌实验室<small>RIVER LAB</small>
          </span>
        </a>
        <div className={s.headerIntro}>
          <h1>
            还原手牌，<span>看清胜算</span>
          </h1>
          <p>从手牌到决策，让每一个数字都更清楚</p>
        </div>
        <div className={s.headerRight}>
          <span className={s.version}>德州扑克 · 牌局分析</span>
          <button
            className={s.connection}
            onClick={() => {
              retryConnection();
            }}
            title="点击重新检查计算服务"
          >
            <i
              className={
                connection === "online"
                  ? s.online
                  : connection === "loading"
                    ? s.connecting
                    : s.offline
              }
            />
            {connection === "online"
              ? "计算服务已连接"
              : connection === "loading"
                ? "连接计算服务"
                : "服务未连接 · 重试"}
          </button>
        </div>
      </header>
      <main className={s.main}>
        <div>
          <WorkspaceBar
            active={activePanel}
            onSelect={selectPanel}
            status={taskStatus}
          >
            <QuickAnalysis analysis={quickAnalysis} />
          </WorkspaceBar>
          <div className={w.notice} ref={notice}>
            {errors.length > 0 && (
              <div className={s.errorBox} role="alert">
                {errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            )}
            {message && (
              <p className={s.message} role="status">
                {message}
              </p>
            )}
          </div>
          <div ref={workspace} className={w.content}>
            <WorkspacePanel id="scenario" active={activePanel}>
              <div
                className={s.modeSwitch}
                role="group"
                aria-label="牌局交互模式"
              >
                <button
                  aria-pressed={mode === "snapshot"}
                  onClick={() => setMode("snapshot")}
                >
                  局面录入
                </button>
                <button
                  aria-pressed={mode === "live"}
                  onClick={() => setMode("live")}
                >
                  逐步记录
                </button>
              </div>
              <div hidden={mode !== "live"}>
                <LiveTable
                  key={game ? "recorded" : "unrecorded"}
                  CardView={Card}
                  Picker={CardPicker}
                  analyzing={busy}
                  onAnalyze={(scene) => {
                    if (!busy) void calculate(scene);
                  }}
                />
                <div className={ui.scenarioTools}>
                  <button onClick={exportScene}>导出当前局面</button>
                </div>
              </div>
              <ScenarioPanel
                {...files}
                busy={busy}
                patch={patch}
                setPicker={setPicker}
                calculate={() => void calculate()}
                onViewResults={showAnalysis}
              />
            </WorkspacePanel>
            <WorkspacePanel id="opponents" active={activePanel}>
              <div className={ui.resultPanel}>
                <OpponentSettings CardView={Card} onPick={setPicker} />
              </div>
            </WorkspacePanel>
            <WorkspacePanel id="analysis" active={activePanel}>
              <AnalysisSettings strategies={strategies} />
              <QuickAnalysisDetails analysis={quickAnalysis} />
              <AnalysisPanel
                analysis={analysis}
                strategies={strategies}
                resultPanel={resultPanel}
              />
            </WorkspacePanel>
            <WorkspacePanel id="table" active={activePanel}>
              <TableSettings />
            </WorkspacePanel>
          </div>
        </div>
        <footer className={s.footer}>
          <span>
            河牌实验室 <b>RIVER LAB</b>
          </span>
          <span>用于学习与复盘 · 结果取决于输入与模型假设</span>
        </footer>
      </main>
      {picker && (
        <CardPicker
          draft={draft}
          target={picker}
          onSelect={setCard}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
