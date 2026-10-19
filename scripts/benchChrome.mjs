// Usage: node scripts/benchChrome.mjs "http://localhost:4173/bench.html?auto=1" (needs a running preview server; macOS Chrome path).
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
const url = process.argv[2];
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new","--remote-debugging-port=9333","--window-size=1564,1300","--force-device-scale-factor=2","--use-angle=metal","--enable-gpu",`--user-data-dir=${tmpdir()}/footfall-bench-chrome`,"about:blank"],{stdio:"ignore"});
await new Promise(r=>setTimeout(r,3000));
const tabs = await (await fetch("http://127.0.0.1:9333/json")).json();
const ws = new WebSocket(tabs.find(t=>t.type==="page").webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0; const pend=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
await send("Emulation.setDeviceMetricsOverride",{width:1564,height:1300,deviceScaleFactor:2,mobile:false});
await send("Page.navigate",{url});
for(let k=0;k<40;k++){await new Promise(r=>setTimeout(r,1000)); const r=await send("Runtime.evaluate",{expression:"JSON.stringify(window.__benchResult||null)"}); if(r.result.result.value!=="null"){console.log(r.result.result.value);break;} if(k===39)console.log("timeout");}
const e=await send("Runtime.evaluate",{expression:"document.getElementById('overlay').textContent"});console.log(e.result.result.value);
chrome.kill();ws.close();
