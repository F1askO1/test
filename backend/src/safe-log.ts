// Never serialize an exception, its request, URL or payload. Libraries may embed tokens there.
export function safeError(error: unknown): string {
  const e = error as {
    name?: unknown;
    code?: unknown;
    error_code?: unknown;
    cause?: { code?: unknown };
    error?: { code?: unknown };
  };
  const codes = [e?.code, e?.error_code, e?.cause?.code, e?.error?.code].filter(
    (x) =>
      typeof x === "number" ||
      (typeof x === "string" &&
        /^(?:E[A-Z_]{2,32}|ABORT_ERR|UND_ERR_[A-Z_]+)$/.test(x)),
  );
  const name =
    typeof e?.name === "string" &&
    [
      "Error",
      "HttpError",
      "GrammyError",
      "AbortError",
      "TimeoutError",
      "FetchError",
      "TypeError",
    ].includes(e.name)
      ? e.name
      : "Error";
  return `${name}${codes.length ? " code=" + codes.join(",") : ""}`;
}
export type Logger = (component: string, message: string) => void;
export const log: Logger = (component, message) =>
  console.log(`[${component}] ${message}`);
