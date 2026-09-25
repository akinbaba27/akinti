import { describe, expect, it } from "vitest";

import { echoReducer, type EchoState } from "./echoReducer";

const BASE: EchoState = { isEchoed: false, echoCount: 4, status: "idle" };

describe("echoReducer", () => {
  it("optimistically echoes: flips isEchoed, increments the count, marks pending", () => {
    const next = echoReducer(BASE, { type: "toggle" });
    expect(next).toEqual({ isEchoed: true, echoCount: 5, status: "pending" });
  });

  it("optimistically un-echoes: flips isEchoed, decrements the count", () => {
    const echoed: EchoState = { isEchoed: true, echoCount: 5, status: "idle" };
    const next = echoReducer(echoed, { type: "toggle" });
    expect(next).toEqual({ isEchoed: false, echoCount: 4, status: "pending" });
  });

  it("never lets the count go negative", () => {
    const empty: EchoState = { isEchoed: true, echoCount: 0, status: "idle" };
    const next = echoReducer(empty, { type: "toggle" });
    expect(next.echoCount).toBe(0);
  });

  it("confirm clears the pending status without touching isEchoed/count", () => {
    const pending: EchoState = { isEchoed: true, echoCount: 5, status: "pending" };
    expect(echoReducer(pending, { type: "confirm" })).toEqual({
      isEchoed: true,
      echoCount: 5,
      status: "idle",
    });
  });

  it("rollback undoes the optimistic toggle and reports an error", () => {
    const pending = echoReducer(BASE, { type: "toggle" });
    const rolledBack = echoReducer(pending, { type: "rollback" });
    expect(rolledBack).toEqual({ isEchoed: false, echoCount: 4, status: "error" });
  });

  it("toggle then rollback is a full round trip back to the original count", () => {
    const optimistic = echoReducer(BASE, { type: "toggle" });
    const rolledBack = echoReducer(optimistic, { type: "rollback" });
    expect(rolledBack.isEchoed).toBe(BASE.isEchoed);
    expect(rolledBack.echoCount).toBe(BASE.echoCount);
  });
});
