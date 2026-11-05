import { test } from "node:test";
import assert from "node:assert/strict";
import { signed } from "./helpers.js";
import { verifyInitData } from "../backend/src/auth.js";

test("valid Telegram signature", () =>
  assert.equal(verifyInitData(signed(), "test-token", 1700000001).id, 22));
test("reject forged, expired, future, duplicate and malformed Telegram data", () => {
  for (const raw of [
    signed().replace("22", "23"),
    signed(22, 1600000000),
    signed(22, 1800000000),
    signed() + "&auth_date=1700000000",
    "hash=foo",
    "",
  ])
    assert.throws(() => verifyInitData(raw, "test-token", 1700000001));
  assert.throws(() => verifyInitData(signed(), "wrong-token", 1700000001));
});
