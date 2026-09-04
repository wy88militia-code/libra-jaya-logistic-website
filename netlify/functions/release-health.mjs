const RELEASE_VERSION='2026.09.04-PILOT-FINAL';

export default async ()=>{
  const body={
    ok:true,
    service:'libra-jaya-logistic',
    releaseVersion:RELEASE_VERSION,
    commitRef:String(process.env.COMMIT_REF||''),
    deployId:String(process.env.DEPLOY_ID||''),
    context:String(process.env.CONTEXT||''),
    branch:String(process.env.BRANCH||''),
    siteName:String(process.env.SITE_NAME||''),
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
