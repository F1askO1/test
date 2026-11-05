// Never serialize an exception, its request, URL or payload. Libraries may embed tokens there.
export function safeError(error: unknown): string {
  const e = error as {
    name?: unknown;
    code?: unknown;
    error_code?: unknown;
    cause?: { code?: unknown };
    error?: { code?: unknown; message?: unknown };
  };
  const codes = [e?.code, e?.error_code, e?.cause?.code, e?.error?.code].filter(
    (x) =>
      typeof x === "number" ||
      (typeof x === "string" &&
        /^(?:E[A-Z_]{2,40}|ABORT_ERR|UND_ERR_[A-Z_]+|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/.test(
          x,
        )),
  );
  if (
    typeof e?.error?.message === "string" &&
    /^Request to '[A-Za-z]+' timed out after [0-9]+ seconds$/.test(
      e.error.message,
    ) &&
    !codes.includes("ETIMEDOUT")
  )
    codes.push("ETIMEDOUT");
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
  console.log(
    JSON.stringify({ time: new Date().toISOString(), component, message }),
  );
