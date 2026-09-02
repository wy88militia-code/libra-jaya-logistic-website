import crypto from 'node:crypto';

const apiKey=process.env.LIBRA_API_KEY;
const apiSecret=process.env.LIBRA_API_SECRET;
const baseUrl=process.env.LIBRA_API_URL||'https://librajayalogistic.com';
if(!apiKey||!apiSecret)throw new Error('Set LIBRA_API_KEY dan LIBRA_API_SECRET.');

const path='/api/v1/quote';
const payload={kodeWilayah:'ISI_KODE_WILAYAH',weightKg:10};
const body=JSON.stringify(payload);
const timestamp=String(Math.floor(Date.now()/1000));
const nonce=crypto.randomBytes(16).toString('hex');
const bodyHash=crypto.createHash('sha256').update(body).digest('hex');
const canonical=`POST\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
const signature=crypto.createHmac('sha256',apiSecret).update(canonical).digest('base64url');

const response=await fetch(`${baseUrl}${path}`,{method:'POST',headers:{'content-type':'application/json','x-libra-key':apiKey,'x-libra-timestamp':timestamp,'x-libra-nonce':nonce,'x-libra-signature':signature},body});
console.log(response.status,await response.text());
