import crypto from 'node:crypto';

const [username,pin,role='ADMIN']=process.argv.slice(2);
if(!username||!/^\d{6,12}$/.test(String(pin||''))){console.error('Usage: node scripts/generate-admin-user.mjs <username> <PIN 6-12 digit> [ROLE]');process.exit(1);}
const salt=crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync(pin,salt,64).toString('hex');
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';const bytes=crypto.randomBytes(20);let bits=[...bytes].map(b=>b.toString(2).padStart(8,'0')).join('');let secret='';for(let i=0;i<bits.length;i+=5){const chunk=bits.slice(i,i+5).padEnd(5,'0');secret+=alphabet[parseInt(chunk,2)];}
console.log(JSON.stringify({username,role:String(role).toUpperCase(),active:true,pinSalt:salt,pinHash:hash,totpSecret:secret},null,2));
console.error('\nSimpan record di ADMIN_USERS_JSON. Masukkan totpSecret ke aplikasi authenticator pengguna, jangan ke repository.');
