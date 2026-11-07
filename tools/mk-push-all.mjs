import fs from "fs";
const ps = [];
for (let i = 0; i < 6; i++) {
  ps.push(fs.readFileSync(`tools/push-${i}.txt`, "utf8").replace(/; 'ok\d+'$/, ""));
}
const combo = `${ps.join(";")}; localStorage.setItem('mgFlowN','6'); 'all'`;
fs.writeFileSync("tools/push-all.txt", combo);
console.log(combo.length);
