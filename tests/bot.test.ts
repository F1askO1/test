import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBot } from "../backend/src/bot.js";
import { openDb } from "../backend/src/db.js";
test("bot /start, /help and /stats dispatch real handlers with Mini App button (Telegram API mocked)", async () => {
  const db = openDb(":memory:");
  try {
    const bot = makeBot("123456:test", "https://example.com", db),
      sent: any[] = [];
    bot.api.config.use(async (_previous, method, payload) => {
      if (method === "getMe")
        return {
          ok: true,
          result: {
            id: 123456,
            is_bot: true,
            first_name: "SlopeMate",
            username: "slopemate_test_bot",
          },
        } as any;
      if (method === "sendMessage") {
        sent.push(payload);
        return {
          ok: true,
          result: {
            message_id: 1,
            date: 1,
            chat: { id: 22, type: "private" },
            text: (payload as any).text,
          },
        } as any;
      }
      throw new Error(`Unexpected ${method}`);
    });
    await bot.init();
    for (const command of ["start", "help", "stats"])
      await bot.handleUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 22, type: "private", first_name: "R" },
          from: { id: 22, is_bot: false, first_name: "R" },
          text: `/${command}`,
          entities: [
            { offset: 0, length: command.length + 1, type: "bot_command" },
          ],
        },
      });
    assert.equal(sent.length, 3);
    assert.equal(
      sent[0].reply_markup.inline_keyboard[0][0].web_app.url,
      "https://example.com",
    );
    assert.match(sent[2].text, /нет записей/);
  } finally {
    db.close();
  }
});
