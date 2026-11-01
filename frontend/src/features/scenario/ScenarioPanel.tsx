import { useScenario } from "../../state";
import type { Draft } from "../../model";
import { Card } from "../../shared/cards/Card";
import type { CardTarget } from "../../shared/cards/types";
import type { useScenarioFiles } from "./useScenarioFiles";
import s from "./ScenarioPanel.module.css";
import ui from "../../shared/ui/Shared.module.css";
type Props = ReturnType<typeof useScenarioFiles> & {
  busy: boolean;
  patch: (value: Partial<Draft>) => void;
  setPicker: (target: CardTarget) => void;
  calculate: () => void;
  onViewResults: () => void;
};
export default function ScenarioPanel({
  busy,
  patch,
  setPicker,
  calculate,
  onViewResults,
  fileInput,
  exportScene,
  importScene,
  reset,
}: Props) {
  const { draft, game, mode } = useScenario();
  return (
    <section
      className={ui.inputPanel}
      aria-label="牌局设置"
      style={{ display: mode === "snapshot" ? undefined : "none" }}
    >
      <div className={s.panelHeading}>
        <div>
          <span className={ui.eyebrow}>SCENARIO / 01</span>
          <h2>当前局面</h2>
        </div>
        <button className={s.exampleButton} onClick={() => reset(true)}>
          载入示例 ↗
        </button>
      </div>
      {game && (
        <p className={ui.caution}>
          当前与逐步记录共用同一手牌。直接修改牌面、阶段或底池后，行动历史将不再适用。
        </p>
      )}
      <section className={ui.section}>
        <div className={ui.sectionHeading}>
          <h3>
            <span>01</span> 我的手牌
          </h3>
          <span className={ui.sectionMeta}>仅对你可见</span>
        </div>
        <div className={s.heroRow}>
          <div className={ui.cards}>
            {draft.hero.map((card, index) => (
              <Card
                key={index}
                value={card}
                label={`手牌 ${index + 1}`}
                onClick={() => setPicker({ group: "hero", index })}
                onRemove={() => {
                  const hero = [...draft.hero] as Draft["hero"];
                  hero[index] = null;
                  patch({ hero });
                }}
              />
            ))}
          </div>
          <div className={s.handSummary}>
            <span className={s.handBadge}>
              {draft.hero.filter((card) => card !== null).length === 2
                ? "手牌已就绪"
                : "从这里开始"}
            </span>
            {!draft.hero.every((card) => card !== null) && <p>点选两张手牌</p>}
          </div>
        </div>
      </section>
      <section className={ui.section}>
        <div className={ui.sectionHeading}>
          <h3>
            <span>02</span> 公共牌
          </h3>
          <span className={ui.sectionMeta}>
            {["翻前", "", "", "翻牌", "转牌", "河牌"][draft.boardSize]}
          </span>
        </div>
        <div className={s.segmented} aria-label="选择牌局阶段">
          {(
            [
              { size: 0, label: "翻前" },
              { size: 3, label: "翻牌" },
              { size: 4, label: "转牌" },
              { size: 5, label: "河牌" },
            ] as const
          ).map((stage) => (
            <button
              key={stage.size}
              aria-label={`${stage.label}${stage.size ? ` ${stage.size} 张` : ""}`}
              aria-pressed={draft.boardSize === stage.size}
              className={draft.boardSize === stage.size ? s.segmentActive : ""}
              onClick={() =>
                patch({
                  boardSize: stage.size,
                  board: draft.board.slice(0, stage.size),
                })
              }
            >
              {stage.label}
              <small>{stage.size === 0 ? "—" : `${stage.size} 张`}</small>
            </button>
          ))}
        </div>
        {draft.boardSize > 0 && (
          <div className={`${ui.cards} ${s.boardCards}`}>
            {Array.from({ length: draft.boardSize }, (_, index) => (
              <Card
                key={index}
                small
                value={draft.board[index] ?? null}
                label={
                  index < 3
                    ? `翻牌 ${index + 1}`
                    : index === 3
                      ? "转牌"
                      : "河牌"
                }
                onClick={() =>
                  setPicker({
                    group: "board",
                    index: Math.min(index, draft.board.length),
                  })
                }
                onRemove={() =>
                  patch({
                    board: draft.board.filter((_, i) => i !== index),
                  })
                }
              />
            ))}
          </div>
        )}
      </section>
      <section className={ui.section}>
        <div className={ui.sectionHeading}>
          <h3>
            <span>03</span> 底池与跟注
          </h3>
          <span className={ui.sectionMeta}>单底池 · 无抽水</span>
        </div>
        <div className={s.moneyGrid}>
          <label>
            当前底池
            <div>
              <input
                inputMode="numeric"
                value={draft.pot}
                onChange={(event) => patch({ pot: event.target.value })}
                aria-label="当前底池"
              />
              <small>筹码</small>
            </div>
          </label>
          <label>
            需要跟注
            <div>
              <input
                inputMode="numeric"
                value={draft.call}
                onChange={(event) => patch({ call: event.target.value })}
                aria-label="需要跟注"
              />
              <small>筹码</small>
            </div>
          </label>
        </div>
        <label className={s.checkbox}>
          <input
            type="checkbox"
            checked={!draft.futureBetting}
            onChange={(event) =>
              patch({ futureBetting: !event.target.checked })
            }
          />
          <span>跟注后直接摊牌，后续无需追加筹码</span>
        </label>
        {draft.futureBetting && (
          <p className={ui.caution}>
            后续仍可下注：EV 仅作“无后续投入”假设下的参考。
          </p>
        )}
      </section>
      <div className={ui.inputActions}>
        <div className={s.calculateDock}>
          <button
            className={ui.calculateButton}
            disabled={busy}
            onClick={() => void calculate()}
          >
            <span>{busy ? "精细分析进行中" : "精细分析当前牌局"}</span>
            <span>{busy ? "◌" : "→"}</span>
          </button>
          <button className={s.mobileResultButton} onClick={onViewResults}>
            <span aria-hidden="true">↗</span>
            查看结果
          </button>
        </div>
        <details className={ui.optionalSettings}>
          <summary>
            牌局工具 <span>自动保存 · 导入 / 导出</span>
          </summary>
          <div className={ui.scenarioTools}>
            <span>◦ 牌局自动保存在此浏览器</span>
            <div>
              <button onClick={() => reset(false)}>重置</button>
              <button onClick={() => fileInput.current?.click()}>导入</button>
              <button onClick={exportScene}>导出</button>
            </div>
          </div>
        </details>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => void importScene(event)}
        />
      </div>
    </section>
  );
}
