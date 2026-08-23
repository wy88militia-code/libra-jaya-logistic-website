import crypto from 'node:crypto';

const COOKIE_NAME='libra_admin_session';
const SESSION_SECONDS=30*60;

function safeEqual(left,right){
  const a=Buffer.from(String(left));
  const b=Buffer.from(String(right));
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

function sign(value,secret){
  return crypto.createHmac('sha256',secret).update(value).digest('base64url');
}

export default async request=>{
  if(request.method!=='POST')return Response.json({message:'Metode tidak diizinkan.'},{status:405});
  const configuredPin=process.env.ADMIN_PIN;
  const sessionSecret=process.env.ADMIN_SESSION_SECRET;
  if(!configuredPin||!sessionSecret||sessionSecret.length<32){
    return Response.json({message:'Pengamanan admin belum dikonfigurasi.'},{status:503});
  }
  let body;
  try{body=await request.json();}catch{return Response.json({message:'Permintaan tidak valid.'},{status:400});}
  if(!safeEqual(body?.pin??'',configuredPin)){
    await new Promise(resolve=>setTimeout(resolve,700));
    return Response.json({message:'PIN salah. Akses ditolak.'},{status:401});
  }
  const expires=Math.floor(Date.now()/1000)+SESSION_SECONDS;
  const payload=Buffer.from(JSON.stringify({expires,nonce:crypto.randomBytes(16).toString('hex')})).toString('base64url');
  const token=`${payload}.${sign(payload,sessionSecret)}`;
  return Response.json({ok:true,redirect:'/admin-tool'},{
    status:200,
    headers:{'set-cookie':`${COOKIE_NAME}=${token}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`,'cache-control':'no-store'}
  });
};

export const config={
  path:'/.netlify/functions/admin-auth',
  method:'POST',
  rateLimit:{windowSize:300,windowLimit:5,aggregateBy:'ip',action:'rate_limit'}
};
