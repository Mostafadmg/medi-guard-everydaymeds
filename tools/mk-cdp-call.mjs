import fs from "fs";
const params = JSON.parse(fs.readFileSync("tools/_cdp-flow-params.json", "utf8"));
const viewId = process.argv[2] || "d0581f";
const out = { viewId, method: "Runtime.evaluate", params };
fs.writeFileSync("tools/_cdp-call.json", JSON.stringify(out));
console.log(viewId, params.expression.length);
