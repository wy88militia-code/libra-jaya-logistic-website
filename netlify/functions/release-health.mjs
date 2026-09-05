import { RELEASE_META } from './_release-meta.mjs';

const RELEASE_VERSION='2026.09.05-RECOVERY-V3';

export default async ()=>{
  const body={
    ok:true,
    service:'libra-jaya-logistic',
    releaseVersion:RELEASE_VERSION,
    commitRef:String(RELEASE_META?.commitRef||''),
    deployId:String(RELEASE_META?.deployId||''),
    context:String(RELEASE_META?.context||''),
    branch:String(RELEASE_META?.branch||''),
    siteName:String(RELEASE_META?.siteName||''),
    stampedAt:RELEASE_META?.stampedAt||null,
    checkedAt:new Date().toISOString(),
  };
  return new Response(JSON.stringify(body),{
    status:200,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store, max-age=0',
      'x-robots-tag':'noindex, nofollow',
      'access-control-allow-origin':'*',
    },
  });
};

export const config={path:'/health/release'};
