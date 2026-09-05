import { findRoute } from './_master-sheet-core.mjs';
import { DJJ_LASTMILE_ENGINE, isDjjLastmileRoute } from './_djj-lastmile-engine.mjs';

const clean=(v,n=180)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();

export const PARTNER_API_SCOPE=Object.freeze({
  code:'LASTMILE_DJJ',
  label:'Last-mile Hub Sentani/Jayapura',
  hub:'DJJ',
  access:'PARTNER_API_ONLY_LASTMILE',
  engineId:DJJ_LASTMILE_ENGINE.id,
});

function requestedService(input={}){
  return upper(input.serviceType||input.service_type||input.service||input.product||input.product_code||'');
}

function assertRequestedService(input={}){
  const requested=requestedService(input);if(!requested)return;
  const allowed=new Set(['LASTMILE','LAST_MILE','LAST-MILE','PTD','PORT_TO_DOOR','PORT TO DOOR','LASTMILE_DJJ']);
  if(!allowed.has(requested)){
    const e=new Error('Partner API hanya tersedia untuk layanan last-mile dari Hub Sentani/Jayapura.');
    e.code='API_SCOPE_FORBIDDEN';e.httpStatus=403;throw e;
  }
}

export async function resolvePartnerApiLastmileRoute(input={}){
  assertRequestedService(input);
  const routeResult=await findRoute({
    kodeRute:input.kodeRute||input.routeCode||input.route_code,
    kodeWilayah:input.kodeWilayah||input.administrativeCode||input.administrative_code,
    kelurahan:input.kelurahan,
    distrik:input.distrik,
  });
  if(!routeResult){const e=new Error('Rute last-mile tidak ditemukan pada Master yang sudah dipublish.');e.code='ROUTE_NOT_FOUND';e.httpStatus=404;throw e;}
  const route=routeResult.route;
  if(!isDjjLastmileRoute(route)){
    const e=new Error('Partner API hanya dapat menggunakan rute last-mile darat dari Hub Sentani/Jayapura (DJJ).');
    e.code='API_SCOPE_FORBIDDEN';e.httpStatus=403;e.routeCode=route.kodeRute||null;throw e;
  }
  return routeResult;
}

export async function assertPartnerApiLastmileInput(input={}){
  const result=await resolvePartnerApiLastmileRoute(input);
  return {scope:PARTNER_API_SCOPE,routeResult:result};
}

export async function assertPartnerApiLastmileQuote(quote={}){
  if(!quote?.kodeRute&&!quote?.kodeWilayah){const e=new Error('Quote API tidak memiliki rute last-mile yang dapat diverifikasi.');e.code='API_SCOPE_FORBIDDEN';e.httpStatus=403;throw e;}
  return assertPartnerApiLastmileInput({kodeRute:quote.kodeRute,kodeWilayah:quote.kodeWilayah,serviceType:'PTD'});
}
