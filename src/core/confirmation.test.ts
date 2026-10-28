/** Regression contracts: pending, cancelled and failed confirmation may never mutate knowledge. */
import { afterEach, expect, it, vi } from "vitest";
import { runConfirmed } from "./confirmation";
import { store } from "./store";
import { removeCategory } from "../services/categories";

afterEach(() => vi.restoreAllMocks());

it.each(["category", "entry", "topic", "edge"] as const)(
  "awaits explicit consent before any %s mutation",
  async (collection) => {
    const batch = vi.spyOn(store, "batchWhen").mockResolvedValue(true);
    const snapshot = store.getSnapshot();
    vi.spyOn(store, "getSnapshot").mockReturnValue({
      ...snapshot,
      categories: [
        { id: "parent", name: "Parent", parent: "" },
        { id: "child", name: "Child", parent: "parent" },
      ],
    });
    let settle!: (value: boolean) => void;
    const choice = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const action =
      collection === "category"
        ? () => removeCategory("parent")
        : () => store.patch(collection, "fixture", { deleted: true });
    const pending = runConfirmed(() => choice, action);
    await Promise.resolve();
    expect(batch).not.toHaveBeenCalled();
    settle(false);
    await pending;
    expect(batch).not.toHaveBeenCalled();
    await expect(
      runConfirmed(() => Promise.reject(Error("confirmation failed")), action),
    ).rejects.toThrow("confirmation failed");
    expect(batch).not.toHaveBeenCalled();
    await expect(
      runConfirmed(() => {
        throw Error("dialog unavailable");
      }, action),
    ).rejects.toThrow("dialog unavailable");
    expect(batch).not.toHaveBeenCalled();
    await runConfirmed(async () => undefined as unknown as boolean, action);
    expect(batch).not.toHaveBeenCalled();
    await runConfirmed(async () => true, action);
    expect(batch).toHaveBeenCalledOnce();
  },
);
