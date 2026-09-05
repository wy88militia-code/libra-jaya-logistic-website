import crypto from 'node:crypto';

function safeEqual(left,right){const a=Buffer.from(String(left??''));const b=Buffer.from(String(right??''));return a.length===b.length&&crypto.timingSafeEqual(a,b);}
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});

async function relay(url,event,token){
  let response;
  try{
    response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-callback-token':token,'x-libra-xendit-relay':'1'},body:JSON.stringify(event)});
  }catch(error){return {ok:false,status:502,body:`Relay failed: ${String(error?.message||error)}`};}
  const body=await response.text();
  return {ok:response.ok,status:response.status,body};
}

export default async request=>{
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  const expected=String(process.env.XENDIT_WEBHOOK_TOKEN||'');
  const supplied=request.headers.get('x-callback-token')||'';
  if(!expected||!safeEqual(expected,supplied))return new Response('Unauthorized',{status:401});
  let event;try{event=await request.json();}catch{return new Response('Invalid JSON',{status:400});}

  const name=String(event?.event||'');
  const data=event?.data||{};
  const purpose=String(data?.metadata?.purpose||'').toUpperCase();
  const reference=String(data?.reference_id||'').toUpperCase();
  let target='';

  if(name==='payment.capture'){
    if(purpose==='PARTNER_DEPOSIT')target='PARTNER';
    else if(purpose==='JL_BOOKING')target='JL';
  }else if(name==='payment_session.completed'||name==='payment_session.expired'){
    if(reference.startsWith('LBRTP-'))target='PARTNER';
    else if(reference.startsWith('JLEXSESS-'))target='JL';
  }

  if(!target)return json({ok:true,ignored:true,event:name});

  const origin=new URL(request.url).origin;
  const partnerUrl=`${origin}/.netlify/functions/xendit-partner-webhook`;
  const jlUrl=String(process.env.JL_EXPRESS_PAYMENT_WEBHOOK_URL||'https://jlexpresssystem.netlify.app/.netlify/functions/xendit-customer-webhook').trim();
  const result=await relay(target==='PARTNER'?partnerUrl:jlUrl,event,expected);
  if(!result.ok)return new Response(result.body||'Downstream webhook failed',{status:result.status||502});
  return json({ok:true,routedTo:target,downstreamStatus:result.status});
};

export const config={path:'/.netlify/functions/xendit-unified-webhook',method:'POST'};
