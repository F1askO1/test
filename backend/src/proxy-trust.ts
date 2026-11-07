export function proxyTrust(raw = "0"): number | "loopback" {
  if (raw === "loopback") return raw;
  const n = Number(raw);
  if (
    !Number.isInteger(n) ||
    n < 0 ||
    n > 3 ||
    raw.trim() === "" ||
    raw === "true"
  )
    throw new Error("TRUST_PROXY must be loopback or a bounded hop count 0..3");
  return n;
}
