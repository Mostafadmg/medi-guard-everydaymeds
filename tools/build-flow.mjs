import fs from "fs";
let prep = fs.readFileSync("tools/_prep-oneline.txt", "utf8").trim();
prep = prep.replace(/^\(async \(\) => \{/, "async () => {").replace(/\}\)\(\)$/, "}");
let swal = fs.readFileSync("tools/ide-swal-verify.txt", "utf8").trim();
swal = swal.replace(/^\(async\(\)=>/, "async () => ").replace(/\)\(\)$/, "");
const flow = `(async()=>{ const prepResult=await (${prep})(); if(prepResult?.prep!=="ready") return {ok:false,...prepResult}; const b=document.querySelector("#rxaApproveBtn:not([disabled])"); if(!b) return {ok:false,err:"no approve btn"}; b.click(); const v=await (${swal})(); return {ok:!v.still, still:v.still, path:location.pathname}; })()`;
fs.writeFileSync("tools/_flow-oneline.txt", flow);
console.log(flow.length);
