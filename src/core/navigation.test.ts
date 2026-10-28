/** Back/forward positions retain exact payloads, reject bounds and branch after a new visit. */
import { expect, it } from "vitest";
import { NavigationTrail } from "./navigation";
it("keeps the latest caret at each page and navigates exact prior positions", () => {
  const trail = new NavigationTrail<{ page: string; caret: number }>(
    (x) => `${x.page}:${x.caret}`,
  );
  trail.visit({ page: "entry-a", caret: 4 });
  trail.replace({ page: "entry-a", caret: 8 });
  trail.visit({ page: "entry-b", caret: 0 });
  expect(trail.step(-1)).toEqual({ page: "entry-a", caret: 8 });
  expect(trail.step(-1)).toBeUndefined();
  expect(trail.step(1)).toEqual({ page: "entry-b", caret: 0 });
  expect(trail.step(1)).toBeUndefined();
});
it("new visits clear the forward branch without losing bounded recent positions", () => {
  const trail = new NavigationTrail<number>(String, 3);
  [1, 2, 3, 4].forEach((x) => trail.visit(x));
  expect(trail.step(-1)).toBe(3);
  expect(trail.step(-1)).toBe(2);
  expect(trail.step(-1)).toBeUndefined();
  trail.visit(5);
  expect(trail.getSnapshot().canForward).toBe(false);
  expect(trail.step(-1)).toBe(2);
});
