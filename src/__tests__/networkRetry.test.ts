import { withNetworkRetry } from "../osvClient";

describe("withNetworkRetry", () => {
  it("should return result immediately on first successful attempt", async () => {
    let calls = 0;
    const result = await withNetworkRetry(async () => {
      calls++;
      return "success";
    });

    expect(result).toBe("success");
    expect(calls).toBe(1);
  });

  it("should retry transient network errors and succeed on subsequent attempt", async () => {
    let calls = 0;
    const result = await withNetworkRetry(async () => {
      calls++;
      if (calls === 1) {
        const error: any = new Error("Connection reset");
        error.code = "ECONNRESET";
        throw error;
      }
      return "retry-success";
    }, 3, 10);

    expect(result).toBe("retry-success");
    expect(calls).toBe(2);
  });

  it("should throw error after reaching max retries for persistent network errors", async () => {
    let calls = 0;
    await expect(
      withNetworkRetry(async () => {
        calls++;
        const error: any = new Error("Network timeout");
        error.code = "ETIMEDOUT";
        throw error;
      }, 2, 10)
    ).rejects.toThrow("Network timeout");

    expect(calls).toBe(2);
  });

  it("should not retry non-retryable client errors like 404 or 400", async () => {
    let calls = 0;
    await expect(
      withNetworkRetry(async () => {
        calls++;
        const error: any = new Error("Bad Request");
        error.response = { status: 400 };
        throw error;
      }, 3, 10)
    ).rejects.toThrow("Bad Request");

    expect(calls).toBe(1);
  });
});
