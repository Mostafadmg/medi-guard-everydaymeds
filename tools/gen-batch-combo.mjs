import fs from "fs";
const fix = fs.readFileSync("tools/ide-fix-validation.txt", "utf8").trim();
const flow = fs.readFileSync("tools/_flow-oneline.txt", "utf8").trim();
const inner = flow.replace(/^\(async\(\)=>/, "").replace(/\)\(\)$/, "");
const combo = `(async()=>{const run=async()=>${inner};let r=await run();if(!r.ok&&(r.prep==="failed"||r.err)){await ${fix};r=await run();}return r;})()`;
fs.writeFileSync("tools/_batch-combo.txt", combo);
fs.writeFileSync(
  "tools/_cdp-flow-params.json",
  JSON.stringify({ expression: combo, awaitPromise: true, returnByValue: true })
);
console.log(combo.length);
