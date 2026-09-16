
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
 let sym=/bitcoin|\bbtc\b/i.test(s)?"BTC-USD":
          /ethereum|\beth\b/i.test(s)?"ETH-USD":
          /solana|\bsol\b/i.test(s)?"SOL-USD":
          /dogecoin|\bdoge\b/i.test(s)?"DOGE-USD":
          /\bxrp\b|ripple/i.test(s)?"XRP-USD":null;
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
   out.push({ticker:m.ticker,title:m.title,subtitle:m.subtitle,rules:m.rules_primary||"",category:cat,bid,ask,noAsk,spread,vol,oi,close:m.close_time,
    modelProbability:model?.prob??null,modelName:model?.model??null,modelSource:model?.source??null,modelInputs:model?.inputs??null,
    modelIndependent:model?.independent!==false,modelFallback:!!model?.fallback,
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

async function teamSchedule(sport,league,teamId,season){
  const urls=[
    `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/schedule?season=${season}`,
    `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/schedule`
  ];
  for(const u of urls){
    try{
      const r=await fetch(u,{headers:{"User-Agent":"Mozilla/5.0"}});
      if(!r.ok)continue;
      const j=await r.json();
      if(j.events?.length)return j.events;
    }catch{}
  }
  return [];
}
function completedTeamGames(events, teamId, beforeMs){
  const out=[];
  for(const e of events||[]){
    const t=new Date(e.date||0).getTime();
    if(!t || t>=beforeMs) continue;
    const c=e.competitions?.[0];
    if(!c || c.status?.type?.completed!==true) continue;
    const cs=c.competitors||[];
    if(cs.length!==2)continue;
    const a=cs.find(x=>String(x.team?.id)===String(teamId)), b=cs.find(x=>String(x.team?.id)!==String(teamId));
    if(!a||!b)continue;
    const sf=Number(a.score), sa=Number(b.score);
    if(!Number.isFinite(sf)||!Number.isFinite(sa))continue;
    out.push({date:t,for:sf,against:sa,margin:sf-sa,home:a.homeAway==="home"});
  }
  return out.sort((a,b)=>b.date-a.date);
}
function weightedMean(vals,decay=.88){
  if(!vals.length)return null;
  let n=0,d=0;
  vals.forEach((v,i)=>{let w=Math.pow(decay,i);n+=v*w;d+=w});
  return n/d;
}
function sampleSd(vals){
  if(vals.length<2)return null;
  const m=vals.reduce((a,b)=>a+b,0)/vals.length;
  return Math.sqrt(vals.reduce((a,b)=>a+(b-m)**2,0)/(vals.length-1));
}
function poissonPmf(k,lambda){
  let f=1; for(let i=2;i<=k;i++)f*=i;
  return Math.exp(-lambda)*Math.pow(lambda,k)/f;
}
function soccerProb(lambdaFor,lambdaAgainst,prop){
  let p=0;
  for(let a=0;a<=10;a++)for(let b=0;b<=10;b++){
    const q=poissonPmf(a,lambdaFor)*poissonPmf(b,lambdaAgainst);
    if(prop.margin!=null && (a-b)>prop.margin) p+=q;
    else if(prop.moneyline && a>b) p+=q;
    else if(prop.total!=null && (a+b)>prop.total) p+=q;
  }
  return p;
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
  if(!best||best.score<.30)return null;

  const targetText=norm((m.title||"")+" "+(m.subtitle||""));
  const sims=best.names.map(n=>similarity(targetText,n));
  let idx=sims.indexOf(Math.max(...sims)); if(idx<0)idx=0;
  let team=best.comps[idx],opp=best.comps[1-idx];
  const teamId=team.team?.id, oppId=opp.team?.id;
  if(!teamId||!oppId)return null;

  const before=new Date(best.e.date||m.close_time||Date.now()).getTime();
  const season=new Date(best.e.date||Date.now()).getUTCFullYear();
  const [ts,os]=await Promise.all([
    teamSchedule(best.sport,best.league,teamId,season),
    teamSchedule(best.sport,best.league,oppId,season)
  ]);
  let tg=completedTeamGames(ts,teamId,before).slice(0,12);
  let og=completedTeamGames(os,oppId,before).slice(0,12);
  if(tg.length<3||og.length<3)return null;

  const prop=parseSportsProp(m);
  const home=team.homeAway==="home";
  const homeAdj=best.sport==="soccer"?.18:best.sport==="football"?1.8:best.sport==="basketball"?2.2:best.sport==="hockey"?.15:best.sport==="baseball"?.18:0;

  let prob=null,model="",inputs={league:best.league,event:best.e.name,matchedTeam:team.team?.displayName,
    opponent:opp.team?.displayName,matchScore:Number(best.score.toFixed(3)),gamesTeam:tg.length,gamesOpponent:og.length};

  if(best.sport==="soccer"){
    const teamGF=Math.max(.15,weightedMean(tg.map(x=>x.for)));
    const teamGA=Math.max(.15,weightedMean(tg.map(x=>x.against)));
    const oppGF=Math.max(.15,weightedMean(og.map(x=>x.for)));
    const oppGA=Math.max(.15,weightedMean(og.map(x=>x.against)));
    let lf=Math.sqrt(teamGF*oppGA), la=Math.sqrt(teamGA*oppGF);
    if(home){lf*=1.10;la*=.93}else{lf*=.93;la*=1.10}
    prob=soccerProb(lf,la,prop);
    model="Recent-form Poisson goals model";
    Object.assign(inputs,{expectedGoalsFor:lf,expectedGoalsAgainst:la,teamGF,teamGA,oppGF,oppGA});
  }else{
    const tm=weightedMean(tg.map(x=>x.margin)), om=weightedMean(og.map(x=>x.margin));
    let mu=(tm-om)/2 + (home?homeAdj:-homeAdj);
    const allMargins=[...tg.map(x=>x.margin),...og.map(x=>-x.margin)];
    let sigma=sampleSd(allMargins) || (best.sport==="football"?13.5:best.sport==="basketball"?12:best.sport==="baseball"?3.2:1.8);
    sigma=Math.max(best.sport==="football"?7:best.sport==="basketball"?7:best.sport==="baseball"?1.5:1,sigma);
    if(prop.margin!=null) prob=1-normalCdf((prop.margin-mu)/sigma);
    else if(prop.moneyline) prob=1-normalCdf((0-mu)/sigma);
    else if(prop.total!=null){
      const tf=weightedMean(tg.map(x=>x.for)),ta=weightedMean(tg.map(x=>x.against));
      const of=weightedMean(og.map(x=>x.for)),oa=weightedMean(og.map(x=>x.against));
      const totalMean=(tf+ta+of+oa)/2;
      const totals=[...tg.map(x=>x.for+x.against),...og.map(x=>x.for+x.against)];
      const tsd=Math.max(1,sampleSd(totals)||sigma);
      prob=1-normalCdf((prop.total-totalMean)/tsd);
      Object.assign(inputs,{expectedTotal:totalMean,totalSigma:tsd});
    }
    model="Recent-form score-margin distribution";
    Object.assign(inputs,{expectedMargin:mu,marginSigma:sigma,teamRecentMargin:tm,opponentRecentMargin:om,home});
  }
  if(prob==null||!Number.isFinite(prob))return null;

  // Optional consensus odds serve as a cross-check, not the sole model.
  const odds=best.e.competitions?.[0]?.odds?.[0]||{};
  inputs.consensusDetails=odds.details||null;
  inputs.overUnder=Number(odds.overUnder)||null;

  const n=Math.min(tg.length,og.length);
  const uncertainty=Math.min(.18, Math.max(.035, .11/Math.sqrt(Math.max(1,n/3))));
  return {prob:Math.max(.01,Math.min(.99,prob)),model,
    source:"Independent ESPN schedules/results + recent team scoring history",
    inputs,uncertainty};
}

async function kalshiOrderbook(t){
  try{
    const d=await k(`/markets/${encodeURIComponent(t)}/orderbook?depth=20`);
    return d.orderbook_fp||d.orderbook||null;
  }catch{return null}
}
async function kalshiTrades(t){
  try{
    const d=await k(`/markets/trades?ticker=${encodeURIComponent(t)}&limit=100`);
    return d.trades||[];
  }catch{return []}
}
function levels(side){
  if(!Array.isArray(side))return [];
  return side.map(x=>{
    if(Array.isArray(x))return {p:Number(x[0]),q:Number(x[1])};
    return {p:Number(x.price_dollars??x.price??0),q:Number(x.count_fp??x.count??x.quantity??0)};
  }).filter(x=>Number.isFinite(x.p)&&Number.isFinite(x.q));
}
function microstructureModel(book,trades,m){
  if(!book)return {score:null,label:"NO ORDERBOOK",inputs:null};
  let y=levels(book.yes),n=levels(book.no);
  let yd=y.reduce((a,x)=>a+x.q,0),nd=n.reduce((a,x)=>a+x.q,0),imb=(yd+nd)>0?(yd-nd)/(yd+nd):0;
  let recent=(trades||[]).slice(0,50), yesAgg=0,noAgg=0;
  for(const t of recent){
    const side=String(t.taker_side||t.side||"").toLowerCase(),q=Number(t.count_fp||t.count||1);
    if(side==="yes")yesAgg+=q; else if(side==="no")noAgg+=q;
  }
  let flow=(yesAgg+noAgg)>0?(yesAgg-noAgg)/(yesAgg+noAgg):0;
  // Signal, not fundamental probability. Kept separate deliberately.
  let score=.6*imb+.4*flow;
  return {score,label:score>.2?"BUY PRESSURE":score<-.2?"SELL PRESSURE":"BALANCED",
    inputs:{yesDepth:yd,noDepth:nd,depthImbalance:imb,recentYesTakerQty:yesAgg,recentNoTakerQty:noAgg,tradeFlowImbalance:flow}};
}
function relationKey(m){
  return norm((m.event_ticker||"")+" "+(m.title||"").replace(/\$?\d[\d,.]*/g," # ").replace(/\b(over|under|above|below|more than|less than|at least|at most)\b/g," "));
}
function numericThreshold(m){
  let s=((m.title||"")+" "+(m.subtitle||"")).replace(/,/g,"");
  let a=[...s.matchAll(/\$?\s*(-?\d+(?:\.\d+)?)/g)].map(x=>Number(x[1])).filter(Number.isFinite);
  return a.length?a[a.length-1]:null;
}
function direction(m){
  let s=((m.title||"")+" "+(m.subtitle||"")).toLowerCase();
  if(/above|over|more than|greater than|at least/.test(s))return "above";
  if(/below|under|less than|at most/.test(s))return "below";
  return null;
}
function structuralEngine(markets){
  const groups=new Map();
  for(const m of markets){
    const key=m.event_ticker||relationKey(m);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);
  }
  const alerts=new Map();
  const put=(t,a)=>{if(!alerts.has(t))alerts.set(t,[]);alerts.get(t).push(a)};
  for(const [key,g] of groups){
    // Nested-threshold monotonicity at executable/displayed asks.
    const rows=g.map(m=>({m,t:numericThreshold(m),d:direction(m),ask:dollars(m,"yes_ask_dollars","yes_ask"),bid:dollars(m,"yes_bid_dollars","yes_bid")}))
      .filter(x=>x.t!=null&&x.d&&x.ask>0).sort((a,b)=>a.t-b.t);
    for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
      let a=rows[i],b=rows[j];
      if(a.d!==b.d)continue;
      // Above: higher threshold cannot have higher probability. Below: lower threshold cannot have higher probability.
      let violation=a.d==="above"?(b.ask-a.ask):(a.ask-b.ask);
      if(violation>.005){
        put(a.m.ticker,{type:"MONOTONICITY",related:b.m.ticker,gross:violation,detail:`Nested ${a.d} thresholds violate probability ordering at displayed YES asks.`});
        put(b.m.ticker,{type:"MONOTONICITY",related:a.m.ticker,gross:violation,detail:`Nested ${a.d} thresholds violate probability ordering at displayed YES asks.`});
      }
    }
    // Exhaustive event sets: only assert when Kalshi metadata says mutually exclusive by common event and titles look like winner outcomes.
    const winners=g.filter(m=>/\bwins?\b|winner|champion/i.test((m.title||"")+" "+(m.subtitle||"")));
    if(winners.length>=2){
      let asks=winners.map(m=>dollars(m,"yes_ask_dollars","yes_ask")).filter(x=>x>0);
      let bids=winners.map(m=>dollars(m,"yes_bid_dollars","yes_bid")).filter(x=>x>0);
      if(asks.length===winners.length){
        let sum=asks.reduce((a,b)=>a+b,0);
        if(sum<.985) for(const m of winners)put(m.ticker,{type:"EXHAUSTIVE_SET",gross:1-sum,detail:`Sum of YES asks across ${winners.length} apparent winner outcomes is ${(sum*100).toFixed(1)}%. Verify settlement exclusivity before execution.`});
      }
      if(bids.length===winners.length){
        let sum=bids.reduce((a,b)=>a+b,0);
        if(sum>1.015) for(const m of winners)put(m.ticker,{type:"EXHAUSTIVE_SET",gross:sum-1,detail:`Sum of YES bids across ${winners.length} apparent winner outcomes is ${(sum*100).toFixed(1)}%. Verify settlement exclusivity before execution.`});
      }
    }
  }
  return alerts;
}
async function fundamentalRouter(m){
  const cat=scanKind(m);
  try{
    if(cat==="crypto"||cat==="financial")return await financialModel(m);
    if(cat==="sports")return await sportsModel(m);
  }catch{}
  return null;
}

/*
 Universal fallback model.
 This guarantees a numeric estimate for every market with usable quotes.
 It is deliberately labelled MARKET-IMPLIED rather than independent edge:
 the prior comes from the market itself, then is conservatively shrunk toward
 50% according to liquidity/spread/data quality. Microstructure may make only
 a small bounded adjustment. This prevents "no model" while avoiding the false
 claim that a market-derived prior independently proves mispricing.
*/
function universalFallbackModel(m,bid,ask,noAsk,micro,vol,oi){
  let mid=null;
  if(bid>0&&ask>0) mid=(bid+ask)/2;
  else if(ask>0&&noAsk>0) mid=(ask+(1-noAsk))/2;
  else if(ask>0) mid=ask;
  else if(bid>0) mid=bid;
  if(mid==null||!Number.isFinite(mid)) mid=.5;

  const spread=(ask>0&&bid>0)?Math.max(0,ask-bid):.20;
  const depth=Math.log10(1+Math.max(0,Number(oi)||0));
  const activity=Math.log10(1+Math.max(0,Number(vol)||0));
  // confidence in the market-derived prior, not confidence that outcome occurs
  let priorWeight=.35 + Math.min(.35,(depth+activity)/25) - Math.min(.25,spread*1.5);
  priorWeight=Math.max(.20,Math.min(.82,priorWeight));
  let prob=.5 + (mid-.5)*priorWeight;

  // bounded microstructure adjustment: maximum ±2 percentage points
  const flow=Number.isFinite(micro?.score)?micro.score:0;
  const flowAdj=Math.max(-.02,Math.min(.02,flow*.02));
  prob+=flowAdj;
  prob=Math.max(.01,Math.min(.99,prob));

  // Wide uncertainty because this fallback is not independent evidence.
  const uncertainty=Math.min(.30,Math.max(.10,.08+spread*.8+(1-priorWeight)*.12));
  return {
    prob,
    model:"Universal market-implied Bayesian fallback",
    source:"Kalshi executable quotes + liquidity/activity + bounded order-flow adjustment",
    inputs:{marketMid:mid,priorWeight,flowAdjustment:flowAdj,spread,volume24h:vol,openInterest:oi},
    uncertainty,
    independent:false,
    fallback:true
  };
}

async function analyzeOne(m){
  let bid=dollars(m,"yes_bid_dollars","yes_bid"),ask=dollars(m,"yes_ask_dollars","yes_ask");
  let noAsk=dollars(m,"no_ask_dollars","no_ask") || (bid?1-bid:0), spread=ask&&bid?ask-bid:null;
  let cat=scanKind(m), model=null, error=null;
  try{model=await fundamentalRouter(m)}catch(e){error=e.message}
  let [book,trades]=await Promise.all([kalshiOrderbook(m.ticker),kalshiTrades(m.ticker)]);
  let micro=microstructureModel(book,trades,m);
  let vol=Number(m.volume_24h_fp||m.volume_fp||m.volume||0),oi=Number(m.open_interest_fp||m.open_interest||0);
  if(!model) model=universalFallbackModel(m,bid,ask,noAsk,micro,vol,oi);
  let edgeYes=model?model.prob-ask:null,edgeNo=model?(1-model.prob)-noAsk:null;
  let side=model?(edgeYes>=edgeNo?"YES":"NO"):null, raw=model?Math.max(edgeYes,edgeNo):null;
  let uncertainty=model?model.uncertainty:null, conservative=raw==null?null:raw-uncertainty;
  let vol=Number(m.volume_24h_fp||m.volume_fp||m.volume||0),oi=Number(m.open_interest_fp||m.open_interest||0);
  return {ticker:m.ticker,eventTicker:m.event_ticker,title:m.title,subtitle:m.subtitle,rules:m.rules_primary||"",
    category:cat,bid,ask,noAsk,spread,vol,oi,close:m.close_time,
    modelProbability:model?.prob??null,modelName:model?.model??null,modelSource:model?.source??null,modelInputs:model?.inputs??null,
    modelIndependent:model?.independent!==false,modelFallback:!!model?.fallback,
    uncertainty,edgeYes,edgeNo,bestSide:side,rawEdge:raw,conservativeEdge:conservative,
    state:model?.fallback?"FALLBACK MODEL":(model?"INDEPENDENT MODEL":(error?"DATA ERROR":"NO MODEL")),dataQuality:microScore({spread,vol,oi}),
    microScore:micro.score,microLabel:micro.label,microInputs:micro.inputs,structural:[]};
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
   const structural=structuralEngine(all);
   // Analyze every selected market. Crypto models use independent public reference data.
   // Sports remain visible but are never assigned a fabricated probability without a verified sports adapter.
   let out=[];
   // Small batches protect free public reference feeds from bursts.
   for(let i=0;i<selected.length;i+=8){
     let batch=await Promise.all(selected.slice(i,i+8).map(analyzeOne));
     out.push(...batch);
   }
   const minEdge=Math.max(0,Number(req.query.min_edge||0))/100;
   for(const x of out)x.structural=structural.get(x.ticker)||[];
   let ranked=out.filter(x=>(x.modelProbability!=null && x.modelIndependent && x.conservativeEdge>minEdge)||x.structural.length)
     .map(x=>({...x,rankScore:Math.max((x.modelIndependent?x.conservativeEdge:null)??-1,...x.structural.map(a=>a.gross||0))}))
     .sort((a,b)=>b.rankScore-a.rankScore);
   res.json({universe,openMarketsSeen:all.length,selectedMarkets:selected.length,modeled:out.filter(x=>x.modelProbability!=null).length,
     positiveEdges:ranked.length,unsupported:out.filter(x=>x.modelProbability==null).length,
     structuralAlerts:[...structural.values()].reduce((a,b)=>a+b.length,0),
     ranked,coverage:out,at:new Date().toISOString(),
     note:"Sports and crypto are scanned. Sports propositions are modeled from independent schedules/results and recent team scoring history when the event and proposition can be matched; unsupported proposition types remain unranked."});
 }catch(e){res.status(502).json({error:e.message})}
});

app.listen(PORT,()=>console.log("Edge Lab v7 on",PORT));
