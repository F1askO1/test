import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  openSync,
  writeFileSync,
  closeSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
export function acquireBotLock(
  token: string,
  directory = join(
    tmpdir(),
    "slopemate-bot-locks-" + (process.getuid?.() ?? "user"),
  ),
) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(
    directory,
    createHash("sha256").update(token).digest("hex") + ".lock",
  );
  const nonce = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(file, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce }));
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          if (JSON.parse(readFileSync(file, "utf8")).nonce === nonce)
            unlinkSync(file);
        } catch {}
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let owner;
      try {
        owner = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        throw Object.assign(new Error("Bot lock unreadable"), {
          code: "E_BOT_LOCKED",
        });
      }
      if (!Number.isInteger(owner.pid) || owner.pid < 1)
        throw Object.assign(new Error("Invalid bot lock"), {
          code: "E_BOT_LOCKED",
        });
      try {
        process.kill(owner.pid, 0);
        throw Object.assign(new Error("Another bot instance"), {
          code: "E_BOT_LOCKED",
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
      }
      // Do not unlink a lock replaced by another contender.
      try {
        if (readFileSync(file, "utf8") === JSON.stringify(owner))
          unlinkSync(file);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
  }
  throw Object.assign(new Error("Bot lock contention"), {
    code: "E_BOT_LOCKED",
  });
}
