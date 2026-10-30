import type { components } from "./generated/schema";

export type Strategy = components["schemas"]["StrategyManifest"];
export type AnalysisResult = components["schemas"]["AnalysisResult"];
export type AnalysisTask = components["schemas"]["TaskSnapshot"];
export type TaskStatus = AnalysisTask["status"];
export type TaskCreated = components["schemas"]["TaskCreated"];
function detailMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((item) =>
        typeof item?.msg === "string" ? item.msg : "输入数据不符合要求",
      )
      .join("；");
  return "服务暂时无法完成请求，请稍后重试。";
}
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new Error("无法连接计算服务，请确认 Python 后端已启动。");
  }
  if (!response.ok) {
    let payload: { detail?: unknown } = {};
    try {
      payload = await response.json();
    } catch {
      /* Proxy errors may not contain JSON. */
    }
    throw new ApiError(
      response.status === 502 || response.status === 503
        ? "计算服务暂时不可用，请确认后端已启动或稍后重试。"
        : detailMessage(payload.detail),
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
export function activeTask(status?: TaskStatus): boolean {
  return status === "queued" || status === "running" || status === "cancelling";
}
