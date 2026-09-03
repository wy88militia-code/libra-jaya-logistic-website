import crypto from 'node:crypto';

const ROLES=new Set(['SUPERADMIN','FINANCE','OPS','CUSTOMER_SERVICE','COURIER']);
const [username,pin,rawRole='CUSTOMER_SERVICE']=process.argv.slice(2);const role=String(rawRole||'').toUpperCase();
if(!username||!/^\d{6,12}$/.test(String(pin||''))||!ROLES.has(role)){console.error('Usage: node scripts/generate-admin-user.mjs <username> <PIN 6-12 digit> <SUPERADMIN|FINANCE|OPS|CUSTOMER_SERVICE|COURIER>');process.exit(1);}
const salt=crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync(pin,salt,64).toString('hex');
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';const bytes=crypto.randomBytes(20);let bits=[...bytes].map(b=>b.toString(2).padStart(8,'0')).join('');let totpSecret='';for(let i=0;i<bits.length;i+=5){const chunk=bits.slice(i,i+5).padEnd(5,'0');totpSecret+=alphabet[parseInt(chunk,2)];}
console.log(JSON.stringify({username,role,active:true,pinSalt:salt,pinHash:hash,totpSecret},null,2));
console.error('\nSimpan record di ADMIN_USERS_JSON. Masukkan totpSecret langsung ke aplikasi authenticator pengguna; jangan ke repository/chat. Maker dan checker wajib username berbeda.');
