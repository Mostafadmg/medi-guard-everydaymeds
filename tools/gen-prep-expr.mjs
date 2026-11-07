import { CLINICAL_CHECK_SOURCE } from "./clinical-check-lib.mjs";
import fs from "fs";
import path from "path";

const expr = `(async () => { const fn = ${CLINICAL_CHECK_SOURCE}; return await fn("not_accessed"); })()`;
const out = path.join(
  process.cwd(),
  "tools",
  "prep-expr-oneline.txt"
);
fs.writeFileSync(out, expr, "utf8");
console.log("written", out, "len", expr.length);
