// Run with environment loaded by an administrator; no secret values or exception URLs are printed.
import { health, endpointIdentity } from "../scripts/network-utils.mjs";
const origin = process.env.APP_URL,
  id = process.env.DEPLOYMENT_ID;
const h = await health(
  "http://127.0.0.1:" + (process.env.PORT || "3001") + "/api/health",
);
console.log("local HTTP:", h.ok ? "ready" : h.reason);
const remote = await endpointIdentity(origin, id);
console.log(
  "public endpoint:",
  remote.ok ? "matches deployment" : remote.reason,
);
if (remote.ok) console.log("components:", JSON.stringify(remote.status));
if (!h.ok || !remote.ok) process.exitCode = 1;
