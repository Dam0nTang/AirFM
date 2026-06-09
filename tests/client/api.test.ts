import { afterEach, describe, expect, it, vi } from "vitest";
import { readErrorMessage, startFmProgram } from "../../src/client/api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("client API errors", () => {
  it("uses server message when a request fails", async () => {
    const response = new Response(
      JSON.stringify({ message: "Claude output was not valid radio JSON" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );

    await expect(readErrorMessage(response, "Chat failed")).resolves.toBe(
      "Chat failed: Claude output was not valid radio JSON"
    );
  });

  it("starts FM programs through the FM endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({
        state: {
          queue: [],
          currentIndex: -1,
          status: "idle",
          messages: [],
          playbackMode: "fm",
          activeView: "fm"
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));

    const result = await startFmProgram();

    expect(fetchMock).toHaveBeenCalledWith("/api/fm/start", { method: "POST" });
    expect(result.state.playbackMode).toBe("fm");
  });
});
