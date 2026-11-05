import { Bot, InlineKeyboard } from "grammy";
import type { DB } from "./db.js";
import { listSessions } from "./db.js";
import { telegramClient } from "./telegram-network.js";

export function makeBot(token: string, url: string, db: DB, proxy = "") {
  const bot = new Bot(token, { client: telegramClient(proxy) });
  const keyboard = () =>
    new InlineKeyboard().webApp("🏔 Открыть приложение", url);
  bot.command("start", (ctx) =>
    ctx.reply(
      "Привет! Это SlopeMate — твоя линия на склоне. Записывай катание, импортируй GPX и следи за прогрессом. GPS работает, пока приложение открыто.",
      { reply_markup: keyboard() },
    ),
  );
  bot.command("help", (ctx) =>
    ctx.reply(
      "Открой приложение → «Катание» → разреши GPS → начни запись. Держи Mini App открытым. История, GPX, демо и профиль доступны внутри. Координаты приватны. /stats — сводка.",
      { reply_markup: keyboard() },
    ),
  );
  bot.command("stats", (ctx) => {
    const sessions = listSessions(db, ctx.from!.id).filter(
      (s) => s.source !== "demo",
    );
    if (!sessions.length)
      return ctx.reply("Пока нет записей. Начни катание или импортируй GPX.", {
        reply_markup: keyboard(),
      });
    const km = sessions.reduce((n, s) => n + s.analysis.distance, 0) / 1000;
    const max = Math.max(...sessions.map((s) => s.analysis.maxSpeed)) * 3.6;
    return ctx.reply(
      `Твои результаты за всё время (без демо):\nЗаписей: ${sessions.length}\nДистанция: ${km.toFixed(1)} км\nМаксимальная скорость: ${max.toFixed(1)} км/ч`,
      { reply_markup: keyboard() },
    );
  });
  return bot;
}
