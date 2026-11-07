import fs from "fs";
const expr = fs.readFileSync("tools/_batch-combo.txt", "utf8");
const chunkSize = 1500;
const chunks = [];
for (let i = 0; i < expr.length; i += chunkSize) {
  chunks.push(expr.slice(i, i + chunkSize));
}
const pushExprs = chunks.map(
  (c, i) =>
    `localStorage.setItem('mgFlow${i}', ${JSON.stringify(c)}); localStorage.setItem('mgFlowN','${chunks.length}'); 'ok${i}'`
);
const runExpr = `(async()=>{const n=+localStorage.getItem('mgFlowN')||0;let e='';for(let i=0;i<n;i++)e+=JSON.parse(localStorage.getItem('mgFlow'+i));return await eval('('+e+')');})()`;
fs.writeFileSync(
  "tools/_flow-chunks.json",
  JSON.stringify({ pushExprs, runExpr, chunks: chunks.length }, null, 2)
);
console.log("chunks", chunks.length, "maxPush", Math.max(...pushExprs.map((p) => p.length)));
