import type { ReactNode } from "react";
import type { WorkspaceTab } from "./WorkspaceBar";
import s from "./Workspace.module.css";

// Keep drafts and task views mounted while removing inactive content from focus and accessibility trees.
export default function WorkspacePanel({
  id,
  active,
  children,
}: {
  id: WorkspaceTab;
  active: WorkspaceTab;
  children: ReactNode;
}) {
  return (
    <div
      id={`workspace-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`workspace-tab-${id}`}
      hidden={active !== id}
      tabIndex={0}
      className={s.panel}
    >
      {children}
    </div>
  );
}
