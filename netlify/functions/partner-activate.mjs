import { claimPartnerActivation, inspectPartnerActivation } from './_partner-activation.mjs';

function clientIp(request){return String(request.headers.get('x-nf-client-connection-ip')||request.headers.get('x-forwarded-for')||'').split(',')[0].trim().slice(0,80);}

export default async request=>{
  if(request.method!=='POST')return Response.json({ok:false,message:'Method not allowed'},{status:405,headers:{'cache-control':'no-store'}});
  let body;try{body=await request.json();}catch{return Response.json({ok:false,message:'Permintaan tidak valid.'},{status:400,headers:{'cache-control':'no-store'}});}
  const action=String(body?.action||'inspect').trim();const activationId=String(body?.activationId||'').trim().slice(0,120);const token=String(body?.token||'').trim().slice(0,300);
  if(!activationId||!token)return Response.json({ok:false,message:'Data link aktivasi tidak lengkap.'},{status:400,headers:{'cache-control':'no-store'}});
  try{
    if(action==='inspect'){
      const info=await inspectPartnerActivation(activationId,token);
      return Response.json({ok:true,info},{headers:{'cache-control':'no-store','pragma':'no-cache'}});
    }
    if(action==='claim'){
      const credentials=await claimPartnerActivation({activationId,token,pin:body?.pin,ipAddress:clientIp(request)});
      return Response.json({ok:true,credentials,message:'Aktivasi berhasil. Simpan kredensial sekarang; halaman ini tidak dapat menampilkannya lagi setelah direfresh.'},{headers:{'cache-control':'no-store','pragma':'no-cache'}});
    }
    return Response.json({ok:false,message:'Aksi tidak dikenal.'},{status:400,headers:{'cache-control':'no-store'}});
  }catch(error){
    const code=String(error?.code||'');const status=code==='INVALID_TOKEN'?403:code==='ACTIVATION_EXPIRED'||code==='ACTIVATION_NOT_ACTIVE'?410:code==='ACTIVATION_BUSY'?409:400;
    return Response.json({ok:false,code:code||'ACTIVATION_ERROR',message:error?.message||'Aktivasi gagal.'},{status,headers:{'cache-control':'no-store','pragma':'no-cache'}});
  }
};

export const config={path:'/.netlify/functions/partner-activate',method:'POST',rateLimit:{windowSize:3600,windowLimit:30,aggregateBy:'ip',action:'rate_limit'}};
