import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import s from "./Workspace.module.css";

export const workspaceTabs = [
  { id: "scenario", label: "当前牌局" },
  { id: "opponents", label: "对手与范围" },
  { id: "analysis", label: "精细分析" },
  { id: "table", label: "牌桌与筹码" },
] as const;
export type WorkspaceTab = (typeof workspaceTabs)[number]["id"];

export default function WorkspaceBar({
  active,
  onSelect,
  status,
  children,
}: {
  active: WorkspaceTab;
  onSelect: (id: WorkspaceTab) => void;
  status: string;
  children: ReactNode;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const measure = () =>
      element.parentElement?.style.setProperty(
        "--workspace-offset",
        `${element.getBoundingClientRect().height + 24}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className={s.bar} ref={bar}>
      {children}
      <div className={s.tabs} role="tablist" aria-label="工作台导航">
        {workspaceTabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`workspace-tab-${tab.id}`}
            aria-controls={`workspace-panel-${tab.id}`}
            aria-selected={active === tab.id}
            tabIndex={active === tab.id ? 0 : -1}
            aria-label={tab.label}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % workspaceTabs.length
                  : event.key === "ArrowLeft"
                    ? (index + workspaceTabs.length - 1) % workspaceTabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? workspaceTabs.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              onSelect(workspaceTabs[next].id);
              const target =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                )[next];
              target?.focus({ preventScroll: true });
              target?.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
          >
            {tab.label}
            {tab.id === "analysis" && status && (
              <span className={s.badge} aria-hidden="true">
                {status}
              </span>
            )}
          </button>
        ))}
      </div>
      <span className={s.srOnly} role="status">
        {status ? `精细分析：${status}` : ""}
      </span>
    </div>
  );
}
