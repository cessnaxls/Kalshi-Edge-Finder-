
import express from "express";
const app=express(), PORT=process.env.PORT||3000;
const BASE="https://external-api.kalshi.com/trade-api/v2";
app.use(express.json({limit:"1mb"})); app.use(express.static("public"));
const ticker=x=>String(x||"").trim().toUpperCase().replace(/[^A-Z0-9._-]/g,"");
async function k(path){let r=await fetch(BASE+path,{headers:{Accept:"application/json"}});if(!r.ok)throw Error(`Kalshi ${r.status}`);return r.json()}
app.get("/api/health",(_,r)=>r.json({ok:true}));

function dollars(m,key,legacy){
 let v=m[key]; if(v!==undefined&&v!==null&&v!=="") return Number(v);
 let q=m[legacy]; return q===undefined||q===null?0:Number(q)/100;
}
function normalCdf(x){let t=1/(1+.2316419*Math.abs(x)),d=.3989423*Math.exp(-x*x/2),p=1-d*t*(.3193815+t*(-.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>=0?p:1-p}
function classify(m){
 let s=((m.title||"")+" "+(m.subtitle||"")+" "+(m.ticker||"")).toLowerCase();
 if(/bitcoin|btc|ethereum|eth|s&p|nasdaq|dow|stock|price|above|below/.test(s)) return "financial";
 if(/temperature|weather|rain|snow|degrees|high temp|low temp/.test(s)) return "weather";
 if(/wins|goals|points|spread|game|match|nba|nfl|mlb|nhl|soccer|football/.test(s)) return "sports";
 if(/cpi|inflation|gdp|unemployment|payroll|fed|rate/.test(s)) return "economics";
 return "general";
}
/* 
 v2 auto model:
 The engine only emits an estimate when it has an independently observable quantitative anchor.
 Current built-in anchor: financial threshold propositions whose underlying can be fetched from
 a public market-data source. Other categories are marked NEEDS DATA ADAPTER rather than fabricated.
*/
async function yahoo(symbol,range="5d",interval="5m"){
 let u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
 let r=await fetch(u,{headers:{"User-Agent":"Mozilla/5.0"}}); if(!r.ok)throw Error("reference data unavailable");
 let j=await r.json(),x=j.chart?.result?.[0]; if(!x)throw Error("reference data unavailable"); return x;
}
function parseFinancial(m){
 let s=(m.title||"")+" "+(m.subtitle||"");
 let sym=/bitcoin|btc/i.test(s)?"BTC-USD":/ethereum|eth/i.test(s)?"ETH-USD":null;
 let nums=[...s.replace(/,/g,"").matchAll(/\$?\s*(\d{2,}(?:\.\d+)?)/g)].map(x=>Number(x[1]));
 let strike=nums.length?Math.max(...nums):null;
 let above=/above|over|greater|at least|more than/i.test(s), below=/below|under|less than/i.test(s);
 return sym&&strike&&(above||below)?{sym,strike,dir:below?"below":"above"}:null;
}
async function financialModel(m){
 let p=parseFinancial(m); if(!p)return null;
 let x=await yahoo(p.sym), closes=(x.indicators?.quote?.[0]?.close||[]).filter(Number.isFinite);
 if(closes.length<20)return null; let spot=closes.at(-1), rets=[];
 for(let i=1;i<closes.length;i++) rets.push(Math.log(closes[i]/closes[i-1]));
 let mean=rets.reduce((a,b)=>a+b,0)/rets.length;
 let sd=Math.sqrt(rets.reduce((a,b)=>a+(b-mean)**2,0)/(rets.length-1));
 let end=new Date(m.close_time||m.expected_expiration_time||Date.now()+3600000).getTime(), mins=Math.max(5,(end-Date.now())/60000);
 let periods=Math.max(1,mins/5), sigma=Math.max(.000001,sd*Math.sqrt(periods));
 let z=Math.log(p.strike/spot)/sigma, pabove=1-normalCdf(z), prob=p.dir==="above"?pabove:1-pabove;
 return {prob:Math.max(.001,Math.min(.999,prob)),model:"Realized-volatility threshold model",source:`${p.sym} public reference feed`,inputs:{spot,strike:p.strike,minutes:mins,sigma},uncertainty:Math.min(.20,.03+sd*Math.sqrt(periods)*2)};
}
function microScore({spread,vol,oi}){
 let s=100-Math.min(50,(spread||.1)*500); s+=Math.min(25,Math.log10(1+vol)*6);s+=Math.min(25,Math.log10(1+oi)*6);return Math.round(Math.max(0,Math.min(100,s/1.5)));
}
app.post("/api/analyze",async(req,res)=>{
 try{
  let ts=[...new Set((req.body.tickers||[]).map(ticker).filter(Boolean))].slice(0,100);
  if(!ts.length)return res.status(400).json({error:"Paste at least one ticker."});
  let d=await k(`/markets?limit=100&tickers=${encodeURIComponent(ts.join(","))}`), out=[];
  for(let m of d.markets||[]){
   let bid=dollars(m,"yes_bid_dollars","yes_bid"),ask=dollars(m,"yes_ask_dollars","yes_ask");
   let noAsk=dollars(m,"no_ask_dollars","no_ask") || (bid?1-bid:0), spread=ask&&bid?ask-bid:null;
   let cat=classify(m), model=null, error=null;
   try{if(cat==="financial")model=await financialModel(m)}catch(e){error=e.message}
   let edgeYes=model?model.prob-ask:null,edgeNo=model?(1-model.prob)-noAsk:null;
   let side=model?(edgeYes>=edgeNo?"YES":"NO"):null, edge=model?Math.max(edgeYes,edgeNo):null;
   let uncertainty=model?model.uncertainty:null, conservative=edge==null?null:edge-uncertainty;
   let vol=Number(m.volume_24h_fp||m.volume_fp||m.volume||0),oi=Number(m.open_interest_fp||m.open_interest||0);
   out.push({ticker:m.ticker,title:m.title,subtitle:m.subtitle,rules:m.rules_primary||"",category:cat,bid,ask,noAsk,spread,vol,oi,close:m.close_time,
    modelProbability:model?.prob??null,modelName:model?.model??null,modelSource:model?.source??null,modelInputs:model?.inputs??null,
    uncertainty,edgeYes,edgeNo,bestSide:side,rawEdge:edge,conservativeEdge:conservative,
    state:model?"MODELED":(error?"DATA ERROR":"NEEDS DATA ADAPTER"),dataQuality:microScore({spread,vol,oi})});
  }
  out.sort((a,b)=>(b.conservativeEdge??-999)-(a.conservativeEdge??-999));
  res.json({results:out,missing:ts.filter(t=>!out.some(x=>x.ticker===t)),at:new Date().toISOString()});
 }catch(e){res.status(502).json({error:e.message})}
});

async function allOpenMarkets(){
  let all=[], cursor="";
  for(let page=0;page<30;page++){
    let path=`/markets?status=open&limit=1000&mve_filter=exclude${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`;
    let d=await k(path); all.push(...(d.markets||[])); cursor=d.cursor||"";
    if(!cursor) break;
  }
  return all;
}
function scanKind(m){
  const s=((m.title||"")+" "+(m.subtitle||"")+" "+(m.event_ticker||"")+" "+(m.ticker||"")).toLowerCase();
  if(/bitcoin|\bbtc\b|ethereum|\beth\b|crypto|solana|\bsol\b|doge|xrp/.test(s)) return "crypto";
  if(/nba|nfl|mlb|nhl|ncaa|soccer|football|baseball|basketball|hockey|tennis|golf|wins|goals|points|spread|match|game/.test(s)) return "sports";
  return classify(m);
}

const ESPN_LEAGUES=[
 ["football","nfl"],["football","college-football"],
 ["basketball","nba"],["basketball","mens-college-basketball"],
 ["baseball","mlb"],["hockey","nhl"],
 ["soccer","eng.1"],["soccer","esp.1"],["soccer","ger.1"],["soccer","ita.1"],["soccer","fra.1"],
 ["soccer","mex.1"],["soccer","usa.1"]
];
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const words=s=>new Set(norm(s).split(" ").filter(x=>x.length>2));
function similarity(a,b){
 const A=words(a),B=words(b); if(!A.size||!B.size)return 0;
 let n=0;for(let x of A)if(B.has(x))n++; return n/Math.max(2,Math.min(A.size,B.size));
}
async function espnScoreboard(sport,league,date){
 const u=`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${date}`;
 const r=await fetch(u,{headers:{"User-Agent":"Mozilla/5.0"}}); if(!r.ok)return [];
 const j=await r.json(); return j.events||[];
}
function logistic(x){return 1/(1+Math.exp(-x))}
function parseSportsProp(m){
 const s=((m.title||"")+" "+(m.subtitle||"")).replace(/−/g,"-");
 let margin=s.match(/(?:more than|over|by)\s+(-?\d+(?:\.\d+)?)\s+(?:goals?|points?)/i);
 let total=s.match(/(?:total|over)\s+(\d+(?:\.\d+)?)/i);
 return {margin:margin?Number(margin[1]):null,total:total?Number(total[1]):null,
   moneyline:/\bwins?\b|winner|to win/i.test(s)};
}
async function sportsModel(m){
 const close=new Date(m.close_time||Date.now()), ds=[];
 for(let d=-1;d<=2;d++){let x=new Date(close);x.setUTCDate(x.getUTCDate()+d);ds.push(x.toISOString().slice(0,10).replaceAll("-",""))}
 let best=null;
 for(const [sport,league] of ESPN_LEAGUES){
   for(const date of ds){
     let evs=await espnScoreboard(sport,league,date);
     for(const e of evs){
       let comps=e.competitions?.[0]?.competitors||[];
       if(comps.length!==2)continue;
       let names=comps.map(c=>c.team?.displayName||c.team?.name||"");
       let score=similarity((m.title||"")+" "+(m.subtitle||""),names.join(" "));
       if(score>(best?.score||0))best={score,e,comps,sport,league,names};
     }
   }
 }
 if(!best||best.score<.34)return null;
 const targetText=norm((m.title||"")+" "+(m.subtitle||""));
 let idx=best.names.map(n=>similarity(targetText,n)).indexOf(Math.max(...best.names.map(n=>similarity(targetText,n))));
 if(idx<0)idx=0; let team=best.comps[idx],opp=best.comps[1-idx];
 // ESPN scoreboard frequently includes consensus provider odds. Use only if present and parseable.
 let odds=best.e.competitions?.[0]?.odds?.[0]||{};
 let details=String(odds.details||"");
 let ou=Number(odds.overUnder||0);
 let fav=null, spread=null;
 let sm=details.match(/^(.+?)\s+(-?\d+(?:\.\d+)?)$/);
 if(sm){fav=norm(sm[1]);spread=Number(sm[2])}
 let teamFav=fav && (norm(team.team?.abbreviation||"").includes(fav)||norm(team.team?.shortDisplayName||"").includes(fav)||fav.includes(norm(team.team?.abbreviation||"")));
 let meanMargin=spread!=null?(teamFav?-spread:spread):0; // favorite -3 => expected target margin +3
 let prop=parseSportsProp(m), prob=null, model="";
 if(prop.margin!=null){
   // Normal margin approximation. Sigma scales by sport.
   let sigma=best.sport==="soccer"?1.55:best.sport==="hockey"?1.8:best.sport==="baseball"?3.2:best.sport==="football"?13.5:12;
   prob=1-normalCdf((prop.margin-meanMargin)/sigma); model="Consensus-spread margin distribution";
 } else if(prop.moneyline && spread!=null){
   let scale=best.sport==="soccer"?1.25:best.sport==="hockey"?1.5:best.sport==="baseball"?2.5:best.sport==="football"?8.5:7.5;
   prob=logistic(meanMargin/scale); model="Consensus-spread win-probability transform";
 }
 if(prob==null)return null;
 // Deliberately wide allowance: this is a screening model, not a bookmaker clone.
 let uncertainty=best.sport==="soccer"?.055:.045;
 return {prob:Math.max(.01,Math.min(.99,prob)),model,source:"Independent ESPN scoreboard/consensus game data",
   inputs:{league:best.league,event:best.e.name,matchedTeam:team.team?.displayName,opponent:opp.team?.displayName,
     matchScore:Number(best.score.toFixed(3)),consensusDetails:details||null,overUnder:ou||null,meanMargin},
   uncertainty};
}

async function analyzeOne(m){
  let bid=dollars(m,"yes_bid_dollars","yes_bid"),ask=dollars(m,"yes_ask_dollars","yes_ask");
  let noAsk=dollars(m,"no_ask_dollars","no_ask") || (bid?1-bid:0), spread=ask&&bid?ask-bid:null;
  let cat=scanKind(m), model=null, error=null;
  try{
    if(cat==="crypto"||cat==="financial") model=await financialModel(m);
    else if(cat==="sports") model=await sportsModel(m);
  }catch(e){error=e.message}
  let edgeYes=model?model.prob-ask:null,edgeNo=model?(1-model.prob)-noAsk:null;
  let side=model?(edgeYes>=edgeNo?"YES":"NO"):null, raw=model?Math.max(edgeYes,edgeNo):null;
  let uncertainty=model?model.uncertainty:null, conservative=raw==null?null:raw-uncertainty;
  let vol=Number(m.volume_24h_fp||m.volume_fp||m.volume||0),oi=Number(m.open_interest_fp||m.open_interest||0);
  return {ticker:m.ticker,eventTicker:m.event_ticker,title:m.title,subtitle:m.subtitle,rules:m.rules_primary||"",
    category:cat,bid,ask,noAsk,spread,vol,oi,close:m.close_time,
    modelProbability:model?.prob??null,modelName:model?.model??null,modelSource:model?.source??null,modelInputs:model?.inputs??null,
    uncertainty,edgeYes,edgeNo,bestSide:side,rawEdge:raw,conservativeEdge:conservative,
    state:model?"MODELED":(error?"DATA ERROR":"NO INDEPENDENT MODEL"),dataQuality:microScore({spread,vol,oi})};
}
app.get("/api/scan",async(req,res)=>{
 try{
   const universe=(req.query.universe||"sports_crypto").toLowerCase();
   const all=await allOpenMarkets();
   let selected=all.filter(m=>{
     let c=scanKind(m);
     return universe==="all" || (universe==="sports_crypto" && (c==="sports"||c==="crypto")) ||
       universe===c || (universe==="crypto"&&c==="financial");
   });
   // Analyze every selected market. Crypto models use independent public reference data.
   // Sports remain visible but are never assigned a fabricated probability without a verified sports adapter.
   let out=[];
   // Small batches protect free public reference feeds from bursts.
   for(let i=0;i<selected.length;i+=8){
     let batch=await Promise.all(selected.slice(i,i+8).map(analyzeOne));
     out.push(...batch);
   }
   const minEdge=Math.max(0,Number(req.query.min_edge||0))/100;
   let ranked=out.filter(x=>x.modelProbability!=null && x.conservativeEdge>minEdge)
     .sort((a,b)=>b.conservativeEdge-a.conservativeEdge);
   res.json({universe,openMarketsSeen:all.length,selectedMarkets:selected.length,modeled:out.filter(x=>x.modelProbability!=null).length,
     positiveEdges:ranked.length,unsupported:out.filter(x=>x.modelProbability==null).length,ranked,coverage:out,at:new Date().toISOString(),
     note:"Sports and crypto are scanned. Sports propositions are modeled only when a matching independent game and usable consensus reference data are found; unsupported propositions remain unranked."});
 }catch(e){res.status(502).json({error:e.message})}
});

app.listen(PORT,()=>console.log("Edge Lab v4 on",PORT));
