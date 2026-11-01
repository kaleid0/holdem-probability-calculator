import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("API error recovery", () => {
  it("preserves status so expired tasks can stop polling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "任务不存在" }), {
          status: 404,
        }),
      ),
    );
    await expect(request("/api/v1/analyses/old")).rejects.toMatchObject({
      status: 404,
      message: "任务不存在",
    });
  });
  it("explains structured validation errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: [{ msg: "重复牌" }] }), {
            status: 422,
          }),
        ),
      ),
    );
    await expect(request("/api/v1/analyses")).rejects.toBeInstanceOf(ApiError);
    await expect(request("/api/v1/analyses")).rejects.toThrow("重复牌");
  });
  it("reports a connection problem without pretending to compute results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(request("/api/v1/strategies")).rejects.toThrow(
      "无法连接计算服务",
    );
  });
});
