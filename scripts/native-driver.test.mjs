/** Prevent application-level refusal values from being confused with WebDriver protocol failures. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeDriverValue } from "./native-driver.mjs";
test("successful script results retain an application's intentional error value", async () => {
  const result = { error: "Invalid capture window" };
  assert.deepEqual(
    await nativeDriverValue(Response.json({ value: result })),
    result,
  );
});
test("a failed WebDriver HTTP response rejects with the protocol diagnostic", async () => {
  await assert.rejects(
    nativeDriverValue(
      Response.json(
        {
          value: {
            error: "element not interactable",
            message: "Target is hidden",
          },
        },
        { status: 400 },
      ),
    ),
    /element not interactable: Target is hidden/,
  );
});
