import "dotenv/config";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { makeBot } from "./bot.js";
const production = process.env.NODE_ENV === "production",
  devAuth = process.env.DEV_AUTH === "true";
const token = process.env.BOT_TOKEN ?? "",
  url = process.env.APP_URL ?? "";
if (token && (!url || new URL(url).protocol !== "https:"))
  throw new Error("Для бота укажите APP_URL с HTTPS");
const db = openDb(process.env.DATABASE_PATH ?? "./data/slopemate.sqlite");
const app = createApp(db, {
  production,
  devAuth,
  token,
  origins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .filter(Boolean)
    .concat(url ? [new URL(url).origin] : []),
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
});
const server = app.listen(
  Number(process.env.PORT ?? 3001),
  process.env.HOST ?? "127.0.0.1",
  () =>
    console.log(
      `SlopeMate API ready on port ${process.env.PORT ?? 3001}; local auth: ${devAuth}`,
    ),
);
const bot = token ? makeBot(token, url, db) : null;
if (bot) {
  await bot.api.setMyCommands([
    { command: "start", description: "Открыть SlopeMate" },
    { command: "help", description: "Помощь" },
    { command: "stats", description: "Моя статистика" },
  ]);
  await bot.api.setChatMenuButton({
    menu_button: { type: "web_app", text: "SlopeMate", web_app: { url } },
  });
  bot
    .start({ onStart: () => console.log("Telegram bot started") })
    .catch((e) => {
      console.error("Bot stopped:", e.message);
      process.exitCode = 1;
      server.close();
    });
} else
  console.log(
    "BOT_TOKEN not set: browser development only; Telegram bot is not running.",
  );
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    if (bot?.isRunning()) bot.stop();
    server.close(() => {
      db.close();
      process.exit();
    });
  });
