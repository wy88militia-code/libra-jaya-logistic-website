import {json,assertIndriSession,listPtpDestinations} from './_indri-cgk-core.mjs';
export default async request=>{
  try{assertIndriSession(request);}catch(e){return json({message:e.message},e.status||401);}
  if(request.method!=='GET')return json({message:'Metode tidak diizinkan.'},405);
  try{return json({items:await listPtpDestinations(request)});}catch(e){return json({message:e.message||'Gagal membaca rute JL Master.'},502);}
};
export const config={path:'/.netlify/functions/indri-cgk-routes',method:'GET'};
