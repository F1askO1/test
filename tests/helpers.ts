import { createHmac } from "node:crypto";
export function signed(id = 22, date = 1700000000, token = "test-token") {
  const fields: { [k: string]: string } = {
    auth_date: String(date),
    query_id: "test",
    user: JSON.stringify({ id, first_name: "Райдер" }),
  };
  const text = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return new URLSearchParams({
    ...fields,
    hash: createHmac("sha256", secret).update(text).digest("hex"),
  }).toString();
}
