let D=[];const $=s=>document.querySelector(s),pc=x=>x==null?"—":(x*100).toFixed(1)+"%",ct=x=>x==null?"—":(x*100).toFixed(1)+"¢";
$("#go").onclick=async()=>{let tickers=$("#tickers").value.split(/[\s,]+/).filter(Boolean);if(!tickers.length)return;$("#msg").textContent="Researching markets…";$("#go").disabled=true;try{let r=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tickers})}),j=await r.json();if(!r.ok)throw Error(j.error);D=j.results;render(j)}catch(e){$("#msg").textContent=e.message}finally{$("#go").disabled=false}};
function render(j){$("#stats").classList.remove("hide");$("#results").classList.remove("hide");$("#count").textContent=D.length;$("#modeled").textContent=D.filter(x=>x.state==="MODELED").length;let t=D.find(x=>x.rawEdge!=null);$("#top").textContent=t?pc(t.rawEdge):"—";$("#time").textContent=new Date(j.at).toLocaleTimeString();$("#msg").textContent=j.missing?.length?`Missing: ${j.missing.join(", ")}`:"Analysis complete";
$("#body").innerHTML=D.map((x,i)=>`<tr><td class="market"><b>${x.title||x.ticker}</b><small>${x.ticker}</small></td><td>${x.category.toUpperCase()}</td><td>${ct(x.bid)} / ${ct(x.ask)}</td><td class="${x.modelProbability==null?"state":""}">${x.modelProbability==null?x.state:pc(x.modelProbability)}</td><td>${pc(x.uncertainty)}</td><td>${x.bestSide||"—"}</td><td class="${x.rawEdge>=0?"pos":"neg"}">${x.rawEdge==null?"—":(x.rawEdge>=0?"+":"")+pc(x.rawEdge)}</td><td class="${x.conservativeEdge>=0?"pos":"neg"}">${x.conservativeEdge==null?"—":(x.conservativeEdge>=0?"+":"")+pc(x.conservativeEdge)}</td><td><button class="inspect" onclick="detail(${i})">INSPECT →</button></td></tr>`).join("")}
window.detail=i=>{let x=D[i],modeled=x.modelProbability!=null;$("#detail").innerHTML=`<div class="detailgrid"><div class="card"><div class="eyebrow">${x.ticker} · ${x.category.toUpperCase()}</div><h2>${x.title}</h2><div class="big ${x.rawEdge>=0?"pos":""}">${modeled?((x.rawEdge>=0?"+":"")+pc(x.rawEdge)):"NO MODEL"}</div><p>${modeled?`Raw ${x.bestSide} model/market discrepancy.`:"This proposition was parsed, but this build does not yet have a trustworthy independent data adapter for this market type."}</p>${modeled?`<div class="source"><b>MODEL</b><br>${x.modelName}<br><b>MODEL CLASS</b><br>${x.modelIndependent?"INDEPENDENT REAL-WORLD":"MARKET-IMPLIED FALLBACK"}<br><b>DATA SOURCE</b><br>${x.modelSource}<br><b>INPUTS</b><br>${JSON.stringify(x.modelInputs,null,2)}</div>`:""}<div class="warn">${x.modelFallback?"This is a universal fallback estimate derived partly from Kalshi's own market state. It provides a probability for coverage, but its model/price difference is NOT independent evidence of mispricing and is excluded from fundamental-edge ranking.":modeled?"Conservative edge subtracts the model's uncertainty allowance from raw discrepancy. It is not a guarantee or a calibrated profit forecast.":"No usable quote/model."}</div></div><div class="card"><div class="eyebrow">AUDIT</div>${kv("YES bid",ct(x.bid))}${kv("YES ask",ct(x.ask))}${kv("NO ask",ct(x.noAsk))}${kv("Spread",ct(x.spread))}${kv("Model YES",pc(x.modelProbability))}${kv("Uncertainty allowance",pc(x.uncertainty))}${kv("YES discrepancy",pc(x.edgeYes))}${kv("NO discrepancy",pc(x.edgeNo))}${kv("Market-data quality",x.dataQuality+"/100")}${kv("24h volume",Number(x.vol).toLocaleString())}${kv("Open interest",Number(x.oi).toLocaleString())}${kv("Order-flow signal",x.microLabel||"—")}${kv("Order-flow score",x.microScore==null?"—":x.microScore.toFixed(3))}
<h4>STRUCTURAL CHECKS</h4><p style="color:#87958e;line-height:1.6">${x.structural?.length?x.structural.map(a=>`${a.type}: ${a.detail}`).join("<br><br>"):"No structural violation detected in loaded related markets."}</p>
<h4>SETTLEMENT RULE</h4><p style="color:#87958e;line-height:1.6">${x.rules||"Not returned."}</p></div></div>`;$("#detail").scrollIntoView({behavior:"smooth"})};function kv(a,b){return `<div class="kv"><span>${a}</span><span>${b}</span></div>`}
$("#scan").onclick=async()=>{
  $("#scan").disabled=true; $("#scanmeta").firstElementChild.textContent="Scanning complete open-market universe…";
  try{
    let r=await fetch("/api/scan?universe=all"),j=await r.json(); if(!r.ok)throw Error(j.error);
    $("#scanresults").classList.remove("hide");
    $("#scanstats").textContent=`${j.openMarketsSeen.toLocaleString()} open · ${j.selectedMarkets.toLocaleString()} sports/crypto · ${j.modeled.toLocaleString()} fundamental models · ${j.structuralAlerts.toLocaleString()} structural alerts · ${j.positiveEdges} ranked candidates`;
    $("#scanmeta").firstElementChild.textContent=`Updated ${new Date(j.at).toLocaleTimeString()}`;
    $("#scanbody").innerHTML=(j.ranked?.length?j.ranked:j.coverage||[]).length?(j.ranked?.length?j.ranked:j.coverage||[]).map((x,i)=>`<tr>
      <td class="rank">#${i+1}</td><td class="market"><b>${x.title||x.ticker}</b><small>${x.ticker}</small></td>
      <td>${x.category.toUpperCase()}</td><td>${pc(x.modelProbability)}</td>
      <td>${ct(x.bestSide==="YES"?x.ask:x.noAsk)}</td><td>${x.bestSide}</td>
      <td class="${x.rawEdge>=0?"pos":"neg"}">${x.rawEdge==null?"—":(x.rawEdge>=0?"+":"")+pc(x.rawEdge)}</td><td>${pc(x.uncertainty)}</td><td class="${x.conservativeEdge>=0?"pos":"neg"}">${x.conservativeEdge==null?"—":(x.conservativeEdge>=0?"+":"")+pc(x.conservativeEdge)}</td>
      <td class="${x.structural?.length?"pos":""}">${x.structural?.length?x.structural[0].type:"—"}</td><td>${x.microLabel||"—"}</td></tr>`).join("")
      :`<tr><td colspan="11" class="state">No positive independently modeled uncertainty-adjusted edges found in this scan.</td></tr>`;
  }catch(e){$("#scanmeta").firstElementChild.textContent=e.message}
  finally{$("#scan").disabled=false}
};

async function progressiveScan(){
 const btn=document.getElementById("scanBtn");
 const box=document.getElementById("scanProgress"),fill=document.getElementById("scanProgressFill");
 const phase=document.getElementById("scanPhase"),pct=document.getElementById("scanPercent");
 const count=document.getElementById("scanCount"),elapsed=document.getElementById("scanElapsed");
 if(!box)return;
 box.classList.add("show"); fill.style.width="1%"; pct.textContent="1%"; phase.textContent="Starting scan…";
 count.textContent="0 / 0 markets"; if(btn)btn.disabled=true;
 const began=Date.now();
 let timer=setInterval(()=>{elapsed.textContent=`${Math.floor((Date.now()-began)/1000)}s`},1000);
 try{
   const r=await fetch("/api/scan/start?universe=all&limit=120",{method:"POST"});
   const st=await r.json(); if(!r.ok)throw new Error(st.error||"Could not start scan");
   while(true){
     await new Promise(x=>setTimeout(x,650));
     const pr=await fetch(`/api/scan/progress/${encodeURIComponent(st.jobId)}`);
     const j=await pr.json(); if(!pr.ok)throw new Error(j.error||"Progress request failed");
     fill.style.width=`${j.percent||0}%`; pct.textContent=`${j.percent||0}%`;
     phase.textContent=j.phase||"Scanning…";
     count.textContent=j.total?`${j.done||0} / ${j.total} markets`:j.openMarketsSeen?`${j.openMarketsSeen.toLocaleString()} open markets found`:"Loading markets…";
     if(j.status==="error")throw new Error(j.error||"Scan failed");
     if(j.status==="complete"){
       renderScanResult(j.result);
       break;
     }
   }
 }catch(e){
   phase.textContent=`Scan failed: ${e.message}`; pct.textContent="ERROR"; fill.style.width="100%";
 }finally{clearInterval(timer);if(btn)btn.disabled=false}
}

function renderScanResult(j){
 const stat=document.getElementById("scanStats");
 if(stat)stat.textContent=`${j.openMarketsSeen.toLocaleString()} open · ${j.selectedMarkets.toLocaleString()} selected · ${j.modeled.toLocaleString()} modeled · ${j.independent} independent / ${j.fallback} fallback · ${j.positiveEdges} ranked candidates`;
 const body=document.getElementById("scanBody");
 if(!body)return;
 const arr=j.ranked?.length?j.ranked:(j.coverage||[]);
 body.innerHTML=arr.length?arr.map((x,i)=>`<tr>
   <td>${i+1}</td><td><b>${x.title||x.ticker}</b><br><small>${x.ticker||""}</small></td>
   <td>${x.category||"—"}</td><td>${x.modelProbability==null?"—":pc(x.modelProbability)}</td>
   <td>${x.bestEntry==null?"—":pc(x.bestEntry)}</td><td>${x.bestSide||"—"}</td>
   <td class="${(x.rawEdge??0)>=0?"pos":"neg"}">${x.rawEdge==null?"—":(x.rawEdge>=0?"+":"")+pc(x.rawEdge)}</td>
   <td>${x.uncertainty==null?"—":pc(x.uncertainty)}</td>
   <td class="${(x.conservativeEdge??0)>=0?"pos":"neg"}">${x.conservativeEdge==null?"—":(x.conservativeEdge>=0?"+":"")+pc(x.conservativeEdge)}</td>
   <td class="${x.structural?.length?"pos":""}">${x.structural?.length?x.structural[0].type:"—"}</td>
   <td>${x.microLabel||"—"}</td></tr>`).join(""):`<tr><td colspan="11" class="state">No markets returned.</td></tr>`;
}

// Use the progressive job endpoint for Scan All. Capture phase prevents the older
// one-shot click handler from firing as well.
document.addEventListener("click",e=>{
 if(e.target?.id==="scanBtn"){e.preventDefault();e.stopImmediatePropagation();progressiveScan()}
},true);
