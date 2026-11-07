import fs from "fs";
const prep = JSON.parse(fs.readFileSync("tools/ide-prep.json", "utf8")).expression.replace(/\r\n/g, "\n");
const full = `(async()=>{const prepResult=await (${prep});if(prepResult?.prep!=='ready')return{ok:false,...prepResult};const b=document.querySelector('#rxaApproveBtn:not([disabled])');if(!b)return{ok:false,err:'no approve'};b.click();for(let i=0;i<25;i++){document.querySelector('.swal2-popup.swal2-show .swal2-confirm')?.click();await new Promise(r=>setTimeout(r,120));}await new Promise(r=>setTimeout(r,2000));return{ok:!document.querySelector('.od2-action[data-action="dispensary"]'),path:location.pathname,swal:document.querySelector('.swal2-popup')?.innerText?.slice(0,120)};})()`;
fs.writeFileSync("tools/_final-flow.txt", full);
console.log(full.length);
