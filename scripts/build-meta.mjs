import { recordBuild } from "./build-utils.mjs";
const meta = recordBuild(process.cwd());
console.log("SlopeMate build " + meta.id);
