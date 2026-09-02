import crypto from 'node:crypto';

const COOKIE_NAME='libra_admin_session';
const SESSION_SECONDS=30*60;
function safeEqual(left,right){const a=Buffer.from(String(left??''));const b=Buffer.from(String(right??''));return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function sign(value,secret){return crypto.createHmac('sha256',secret).update(value).digest('base64url');}
function parseUsers(){try{const users=JSON.parse(process.env.ADMIN_USERS_JSON||'[]');return Array.isArray(users)?users:[];}catch{return [];}}
function verifyHashedPin(pin,user){if(!user?.pinSalt||!user?.pinHash)return false;const actual=crypto.scryptSync(String(pin??''),user.pinSalt,64).toString('hex');return safeEqual(actual,user.pinHash);}
function base32(secret){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const char of String(secret||'').toUpperCase().replace(/[^A-Z2-7]/g,'')){const value=alphabet.indexOf(char);if(value<0)continue;bits+=value.toString(2).padStart(5,'0');}const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));return Buffer.from(bytes);}
function totpCode(secret,counter){const key=base32(secret);if(!key.length)return '';const buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt(counter));const digest=crypto.createHmac('sha1',key).update(buf).digest();const offset=digest[digest.length-1]&15;const code=(digest.readUInt32BE(offset)&0x7fffffff)%1000000;return String(code).padStart(6,'0');}
function verifyTotp(code,secret){const clean=String(code||'').replace(/\D/g,'');if(!/^\d{6}$/.test(clean)||!secret)return false;const counter=Math.floor(Date.now()/30000);return [-1,0,1].some(delta=>safeEqual(clean,totpCode(secret,counter+delta)));}

export default async request=>{
 if(request.method!=='POST')return Response.json({message:'Metode tidak diizinkan.'},{status:405});const sessionSecret=process.env.ADMIN_SESSION_SECRET;if(!sessionSecret||sessionSecret.length<32)return Response.json({message:'Pengamanan admin belum dikonfigurasi.'},{status:503});
 let body;try{body=await request.json();}catch{return Response.json({message:'Permintaan tidak valid.'},{status:400});}
 const users=parseUsers();let username='legacy-admin',role='SUPERADMIN',valid=false,otpVerified=false;
 if(users.length){const requested=String(body?.username||'').trim().toLowerCase();const user=users.find(row=>String(row.username||'').trim().toLowerCase()===requested&&row.active!==false);if(user&&verifyHashedPin(body?.pin,user)){if(user.totpSecret){otpVerified=verifyTotp(body?.otp,user.totpSecret);valid=otpVerified;}else valid=true;if(valid){username=String(user.username);role=String(user.role||'ADMIN').toUpperCase();}}}
 else{const configuredPin=process.env.ADMIN_PIN;if(configuredPin&&safeEqual(body?.pin??'',configuredPin)){const secret=process.env.ADMIN_TOTP_SECRET;if(secret){otpVerified=verifyTotp(body?.otp,secret);valid=otpVerified;}else valid=true;username=String(body?.username||'legacy-admin').trim().slice(0,80)||'legacy-admin';}}
 if(!valid){await new Promise(resolve=>setTimeout(resolve,700));return Response.json({message:'Username, PIN, atau OTP salah. Akses ditolak.'},{status:401});}
 const expires=Math.floor(Date.now()/1000)+SESSION_SECONDS;const payload=Buffer.from(JSON.stringify({username,role,otp:otpVerified,expires,nonce:crypto.randomBytes(16).toString('hex')})).toString('base64url');const token=`${payload}.${sign(payload,sessionSecret)}`;
 return Response.json({ok:true,redirect:'/admin-tool',username,role},{status:200,headers:{'set-cookie':`${COOKIE_NAME}=${token}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`,'cache-control':'no-store'}});
};
export const config={path:'/.netlify/functions/admin-auth',method:'POST',rateLimit:{windowSize:300,windowLimit:5,aggregateBy:'ip',action:'rate_limit'}};
