import test from "node:test";
import assert from "node:assert/strict";
import { originAllowed } from "../src/index.js";

const allowed = ["https://brochiefs.com", "https://brochiefs-preview.pages.dev", "https://*.brochiefs-preview.pages.dev"];

test("listed origins and one-level preview subdomains pass", () => {
  assert.ok(originAllowed(allowed, "https://brochiefs.com"));
  assert.ok(originAllowed(allowed, "https://brochiefs-preview.pages.dev"));
  assert.ok(originAllowed(allowed, "https://claude-retro-arcade.brochiefs-preview.pages.dev"));
});

test("look-alikes and other sites are refused", () => {
  assert.equal(originAllowed(allowed, "https://evil.com"), false);
  assert.equal(originAllowed(allowed, "https://evilbrochiefs-preview.pages.dev"), false);
  assert.equal(originAllowed(allowed, "https://a.b.brochiefs-preview.pages.dev"), false);
  assert.equal(originAllowed(allowed, "http://x.brochiefs-preview.pages.dev"), false);
  assert.equal(originAllowed(allowed, "https://brochiefs-preview.pages.dev.evil.com"), false);
  assert.equal(originAllowed(allowed, null), false);
});
