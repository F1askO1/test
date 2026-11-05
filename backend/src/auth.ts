import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
export const telegramUserSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  first_name: z.string().max(256),
  last_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  photo_url: z.string().url().max(2048).optional(),
});
export type TelegramUser = z.infer<typeof telegramUserSchema>;
export function verifyInitData(
  raw: string,
  token: string,
  now = Math.floor(Date.now() / 1000),
): TelegramUser {
  if (!raw || raw.length > 16384)
    throw new Error("Откройте приложение через Telegram");
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length)
    throw new Error("Повторяющиеся поля авторизации");
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash))
    throw new Error("Недействительная подпись");
  params.delete("hash");
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex")))
    throw new Error("Недействительная подпись");
  const date = Number(params.get("auth_date"));
  if (!Number.isInteger(date) || date > now + 30 || now - date > 3600)
    throw new Error("Авторизация истекла. Откройте приложение заново");
  return telegramUserSchema.parse(JSON.parse(params.get("user") ?? "null"));
}
