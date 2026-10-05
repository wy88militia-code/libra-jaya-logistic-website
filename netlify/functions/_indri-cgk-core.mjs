import {getStore} from '@netlify/blobs';
import {getAdminSession} from './_partner-core.mjs';

export const STORE_NAME='libra-indri-cgk';
export const db=()=>getStore({name:STORE_NAME,consistency:'strong'});
export const clean=(v,n=1200)=>String(v??'').trim().slice(0,n);
export const upper=v=>clean(v).toUpperCase();
export const num=v=>Number.isFinite(Number(v))?Number(v):0;
export const json=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
export function indriSession(request){
  const session=getAdminSession(request);
  if(!session)return null;
  const role=upper(session.role);
  if(!['OPS','SUPERADMIN'].includes(role))return null;
  return session;
}
export function assertIndriSession(request){
  const session=indriSession(request);
  if(!session){const e=new Error('Sesi Admin Indri / Soetta tidak valid.');e.status=401;throw e;}
  return session;
}
export async function listPrefix(prefix){
  const store=db(),{blobs}=await store.list({prefix});
  return (await Promise.all(blobs.map(x=>store.get(x.key,{type:'json',consistency:'strong'})))).filter(Boolean);
}
export function actor(request){
  const s=indriSession(request);
  return upper(s?.role)==='SUPERADMIN'?`superadmin:${s?.username||'admin'}`:`ops:${s?.username||'indri'}`;
}
function configValue(value,type){
  const t=upper(type);
  if(t==='BOOLEAN')return ['TRUE','1','YES','Y','AKTIF','ACTIVE'].includes(upper(value));
  if(['NUMBER','PERCENT','KG','IDR'].includes(t))return num(value);
  if(t==='CSV')return clean(value).split(',').map(x=>x.trim()).filter(Boolean);
  return value??'';
}
function setPath(obj,path,value){const parts=String(path||'').split('.').filter(Boolean);let cur=obj;for(let i=0;i<parts.length-1;i++){cur[parts[i]]??={};cur=cur[parts[i]];}if(parts.length)cur[parts.at(-1)]=value;}
function parseConfig(rows=[]){
  const out={margins:{},services:{},insurance:{},promo:{},pricing:{},woodPackingFormula:{}};
  for(const r of rows.slice(1)){
    const group=upper(r[0]),key=clean(r[1]);if(!group||!key)continue;
    const value=configValue(r[2],r[3]);
    if(group==='MARGINS')out.margins[key]=value;
    else if(group==='SERVICES')setPath(out.services,key,value);
    else if(group==='INSURANCE')out.insurance[key]=value;
    else if(group==='PROMO')out.promo[key]=value;
    else if(group==='PRICING')out.pricing[key]=value;
    else if(group==='WOOD_FORMULA')out.woodPackingFormula[key]=value;
  }
  return out;
}
function activeRate(row){
  const today=new Date().toISOString().slice(0,10),status=upper(row[11]);
  if(['INACTIVE','DISABLED','NONAKTIF'].includes(status))return false;
  if(clean(row[9])&&clean(row[9])>today)return false;
  if(clean(row[10])&&clean(row[10])<today)return false;
  return true;
}
function roundUp(value,step=1000){const s=Math.max(1,num(step)||1000);return Math.ceil(num(value)/s)*s;}
function packingVolume(x){return num(x.length)*num(x.width)*num(x.height);}
function woodPrice(packingRows=[],packages=[],round=5000){
  const tiers=packingRows.slice(1).filter(r=>upper(r[0])==='WOOD'&&num(r[8])>0&&['TRUE','1','YES','Y','AKTIF','ACTIVE'].includes(upper(r[9]??true))).map(r=>({length:num(r[3]),width:num(r[4]),height:num(r[5]),price:num(r[8])})).map(x=>({...x,volume:x.length*x.width*x.height})).filter(x=>x.volume>0).sort((a,b)=>a.volume-b.volume);
  if(!tiers.length)return 0;
  let total=0;
  for(const p of packages||[]){
    if(p?.woodPacking===false)continue;
    const volume=packingVolume(p);if(!volume)continue;
    const upperTier=tiers.find(x=>x.volume>=volume);let raw=0;
    if(upperTier){const i=tiers.indexOf(upperTier);if(i===0)raw=upperTier.price;else{const lower=tiers[i-1],span=upperTier.volume-lower.volume,ratio=span>0?(volume-lower.volume)/span:1;raw=lower.price+ratio*(upperTier.price-lower.price);}}
    else{const xl=tiers.at(-1);raw=xl.price*(volume/xl.volume);}
    total+=roundUp(raw,round);
  }
  return total;
}
async function readJlMaster(request){
  const token=clean(Netlify.env.get('JL_SSOT_GATEWAY_TOKEN'));
  if(!token)throw new Error('JL SSOT gateway token belum tersedia di Libra.');
  const url=new URL('/.netlify/functions/jl-master-gateway',request.url);
  const r=await fetch(url,{headers:{authorization:`Bearer ${token}`,accept:'application/json'}});
  const body=await r.json().catch(()=>({}));
  if(!r.ok||!body?.ranges)throw new Error(body?.message||'Master JL Express tidak dapat dibaca.');
  return body;
}
export async function quotePtp(request,input={}){
  const destination=upper(input.destinationAirport);
  if(!/^[A-Z]{3}$/.test(destination)||destination==='CGK')throw new Error('Bandara tujuan PTP tidak valid.');
  const master=await readJlMaster(request),ranges=master.ranges||{},cfg=parseConfig(ranges.config||[]);
  const airlines=new Map((ranges.airline||[]).slice(1).filter(r=>clean(r[0])&&['TRUE','1','YES','Y','AKTIF','ACTIVE'].includes(upper(r[5]??true))).map(r=>[clean(r[0]),{id:clean(r[0]),name:clean(r[1]),adminPerSmu:num(r[2]),minKg:num(r[3])||10}]));
  const candidates=(ranges.rate||[]).slice(1).filter(r=>upper(r[1]||'CGK')==='CGK'&&upper(r[3])===destination&&activeRate(r)&&airlines.has(clean(r[2]))).map(r=>({
    rateId:clean(r[0]),airline:airlines.get(clean(r[2])),destinationName:clean(r[4])||destination,cost:num(r[5]),minKg:num(r[7])||10,adminPerSmu:num(r[8]),source:clean(r[13])
  }));
  if(!candidates.length){const e=new Error(`Tarif CGK → ${destination} belum tersedia di JL_RATE.`);e.code='ROUTE_NOT_PRICED';throw e;}
  const volumeWeight=Math.max(0,num(input.volumeWeight)),actual=Math.max(.01,num(input.actualWeight)),serviceMin=Math.max(1,num(cfg.services?.portToPortMinKg)||10);
  const chargeable=Math.max(actual,volumeWeight),billedBase=Math.max(chargeable,serviceMin);
  candidates.sort((a,b)=>(a.cost*Math.max(billedBase,a.minKg)+a.adminPerSmu)-(b.cost*Math.max(billedBase,b.minKg)+b.adminPerSmu));
  const selected=candidates[0],billedKg=Math.max(billedBase,selected.minKg);
  const marginPercent=num(cfg.margins?.portToPort);
  if(marginPercent<=0){const e=new Error('Margin Port to Port belum diset di JL_CONFIG.');e.code='MARGIN_NOT_CONFIGURED';throw e;}
  const sellRound=Math.max(1,num(cfg.pricing?.roundTo)||1000),sellRatePerKg=roundUp(selected.cost*(1+marginPercent/100),sellRound);
  const cargoBeforePromo=Math.round(sellRatePerKg*billedKg);
  const promoServices=Array.isArray(cfg.promo?.services)?cfg.promo.services.map(upper):[];
  const promoCode=upper(input.promoCode),promoEligible=Boolean(cfg.promo?.active&&num(cfg.promo?.discountPercent)>0&&(!clean(cfg.promo?.code)||promoCode===upper(cfg.promo.code))&&(!promoServices.length||promoServices.includes('PTP')));
  const promoDiscount=promoEligible?Math.round(cargoBeforePromo*num(cfg.promo.discountPercent)/100):0,cargoSubtotal=cargoBeforePromo-promoDiscount;
  const insuranceRate=num(cfg.insurance?.ratePercent)||0.5,insurance=input.insurance===false?0:Math.round(num(input.declaredValue)*insuranceRate/100);
  const packing=input.woodPacking?woodPrice(ranges.packing||[],input.packages||[],num(cfg.woodPackingFormula?.roundTo)||5000):0;
  const adminPerSmu=num(selected.adminPerSmu||selected.airline.adminPerSmu);
  const ppnRatePercent=1.1,ppn=Math.round((cargoSubtotal+adminPerSmu)*ppnRatePercent/100);
  const totalBeforeTax=cargoSubtotal+adminPerSmu+insurance+packing,total=totalBeforeTax+ppn;
  return {bookable:true,service:'PTP',origin:'CGK',destination,destinationName:selected.destinationName,airline:selected.airline,rateId:selected.rateId,modalRatePerKg:selected.cost,marginPercent,sellRatePerKg,billedKg:+billedKg.toFixed(2),chargeableWeight:+chargeable.toFixed(2),cargoBeforePromo,promoDiscount,cargoSubtotal,airlineAdminPerSmu:adminPerSmu,insuranceRatePercent:insuranceRate,insurance,woodPacking:packing,ppnRatePercent,ppn,totalBeforeTax,total,currency:'IDR',source:'LIBRA_JL_SSOT_GATEWAY',capturedAt:master.capturedAt||new Date().toISOString()};
}
