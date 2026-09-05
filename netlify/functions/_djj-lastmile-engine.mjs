const clean=(v,n=180)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;

export const DJJ_LASTMILE_ENGINE=Object.freeze({
  id:'DJJ_LASTMILE_V1',
  hubCode:'DJJ',
  hubLabel:'Hub Sentani/Jayapura',
  scope:'HUB_TO_DOOR',
  channels:Object.freeze(['JLX_INTERNAL','PARTNER_API']),
  routeSource:'MASTER_LASTMILE',
  pricingSource:'MASTER_RATE_ENGINE',
  billingPolicy:Object.freeze({
    sentaniPhysicalCheckMayRepriceCustomer:false,
    partnerApiWeightBasis:'PARTNER_PTI',
    jlxInternalWeightBasis:'JLX_UPSTREAM_FINAL_ARRIVAL',
    incomingHandlingBasis:'UNIQUE_SMU',
  }),
});

export function isDjjLastmileRoute(route={}){
  const hay=upper(`${route.hub||''} ${route.bandaraAsal||''} ${route.networkHub||''}`);
  const hubOk=hay.includes('DJJ')||hay.includes('SENTANI')||hay.includes('DORTHEYS')||hay.includes('JAYAPURA');
  const mode=upper(route.moda||route.jenisAkses||'DARAT');
  const roadOk=!mode||mode==='DARAT'||mode.includes('ROAD');
  return hubOk&&roadOk;
}

export function assertDjjLastmileRoute(route={}){
  if(isDjjLastmileRoute(route))return route;
  const e=new Error('Rute harus merupakan last-mile darat dari Hub Sentani/Jayapura (DJJ).');
  e.code='DJJ_LASTMILE_SCOPE';e.httpStatus=422;e.routeCode=route.kodeRute||null;throw e;
}

export function resolveDjjLastmileWeightBasis(booking={},channel='JLX_INTERNAL'){
  const c=upper(channel)==='PARTNER_API'?'PARTNER_API':'JLX_INTERNAL';
  if(c==='PARTNER_API')return {
    channel:c,
    weightBasis:DJJ_LASTMILE_ENGINE.billingPolicy.partnerApiWeightBasis,
    basisWeightKg:num(booking.smuTotalWeightKg||booking.weightKg),
    sentaniPhysicalCheckMayRepriceCustomer:false,
  };
  return {
    channel:c,
    weightBasis:DJJ_LASTMILE_ENGINE.billingPolicy.jlxInternalWeightBasis,
    basisWeightKg:num(booking.chargeableWeightKg||booking.weightKg),
    sentaniPhysicalCheckMayRepriceCustomer:false,
  };
}

export function djjLastmileMetadata(channel='JLX_INTERNAL'){
  const normalized=upper(channel);return {...DJJ_LASTMILE_ENGINE,channel:DJJ_LASTMILE_ENGINE.channels.includes(normalized)?normalized:'JLX_INTERNAL'};
}
