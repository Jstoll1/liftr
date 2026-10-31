// Pro trial: visits and sessions are tagged pro, classic stays untagged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { styleTag } from "../src/index.js";

test("styleTag keeps pro and drops anything else", () => {
  assert.deepEqual(styleTag({ st: "pro" }), { st: "pro" });
  assert.deepEqual(styleTag({ st: "classic" }), {});
  assert.deepEqual(styleTag({ st: "<script>" }), {});
  assert.deepEqual(styleTag(null), {});
});
