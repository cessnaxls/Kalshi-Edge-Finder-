import express from "express";
const app = express();
const PORT = process.env.PORT || 3000;
const KALSHI = "https://external-api.kalshi.com/trade-api/v2";

app.use(express.json({limit:"1mb"}));
app.use(express.static("public"));

async function kfetch(path) {
  const r = await fetch(KALSHI + path, {headers: {"Accept":"application/json"}});
  if (!r.ok) throw new Error(`Kalshi ${r.status}: ${await r.text()}`);
  return r.json();
}

const cleanTicker = t => String(t||"").trim().toUpperCase().replace(/[^A-Z0-9._-]/g,"");

app.get("/api/health", (_,res)=>res.json({ok:true, time:new Date().toISOString()}));

app.get("/api/markets", async (req,res)=>{
  try {
    const tickers = String(req.query.tickers||"").split(",").map(cleanTicker).filter(Boolean).slice(0,100);
    if (!tickers.length) return res.status(400).json({error:"Provide at least one ticker."});
    const data = await kfetch(`/markets?limit=${Math.min(100,tickers.length)}&tickers=${encodeURIComponent(tickers.join(","))}`);
    res.json(data);
  } catch(e) { res.status(502).json({error:e.message}); }
});

app.get("/api/trades/:ticker", async (req,res)=>{
  try {
    const ticker=cleanTicker(req.params.ticker);
    const data=await kfetch(`/markets/trades?ticker=${encodeURIComponent(ticker)}&limit=100`);
    res.json(data);
  } catch(e){ res.status(502).json({error:e.message}); }
});

/*
 Edge Lab intentionally separates OBSERVED market metrics from USER/MODEL probability.
 A real probability forecast requires market-specific evidence. This server never invents one.
*/
app.post("/api/analyze", async (req,res)=>{
  try {
    const inputs=(req.body.markets||[]).slice(0,100);
    const tickers=inputs.map(x=>cleanTicker(x.ticker)).filter(Boolean);
    if(!tickers.length) return res.status(400).json({error:"No tickers."});
    const data=await kfetch(`/markets?limit=${Math.min(100,tickers.length)}&tickers=${encodeURIComponent(tickers.join(","))}`);
    const byInput=new Map(inputs.map(x=>[cleanTicker(x.ticker),x]));
    const results=(data.markets||[]).map(m=>{
      const inp=byInput.get(m.ticker)||{};
      const bid=Number(m.yes_bid_dollars ?? 0);
      const ask=Number(m.yes_ask_dollars ?? 0);
      const last=Number(m.last_price_dollars ?? 0);
      const midpoint=(bid>0&&ask>0)?(bid+ask)/2:last;
      const spread=(bid>0&&ask>0)?ask-bid:null;
      const model=Number(inp.modelProbability);
      const hasModel=Number.isFinite(model)&&model>=0&&model<=1;
      const feeBuffer=Math.max(0,Number(inp.costBuffer||0))/100;
      const edge=hasModel ? model-ask-feeBuffer : null;
      const noAsk=Number(m.no_ask_dollars ?? (bid?1-bid:0));
      const noEdge=hasModel ? (1-model)-noAsk-feeBuffer : null;
      const side = edge===null ? null : (edge>=noEdge?"YES":"NO");
      const bestEdge=edge===null?null:Math.max(edge,noEdge);
      const liquidity=Number(m.liquidity_dollars||0);
      const vol=Number(m.volume_24h_fp||m.volume_fp||0);
      // Data-quality score only, NOT a probability/confidence in outcome.
      let quality=0;
      if(spread!==null) quality += Math.max(0,40-Math.min(40,spread*400));
      quality += Math.min(30,Math.log10(1+liquidity)*7);
      quality += Math.min(30,Math.log10(1+vol)*7);
      return {
        ticker:m.ticker,title:m.title,subtitle:m.subtitle,status:m.status,eventTicker:m.event_ticker,
        bid,ask,last,midpoint,spread,noAsk,volume24h:vol,liquidity,openInterest:Number(m.open_interest_fp||0),
        closeTime:m.close_time, rules:m.rules_primary||"",
        modelProbability:hasModel?model:null,costBuffer:feeBuffer,
        yesEdge:edge,noEdge,bestSide:side,bestEdge,dataQuality:Math.round(Math.min(100,quality))
      };
    });
    results.sort((a,b)=>(b.bestEdge??-999)-(a.bestEdge??-999));
    res.json({results,missing:tickers.filter(t=>!results.some(r=>r.ticker===t)),generatedAt:new Date().toISOString()});
  } catch(e){ res.status(502).json({error:e.message}); }
});

app.listen(PORT,()=>console.log(`Kalshi Edge Lab listening on ${PORT}`));
