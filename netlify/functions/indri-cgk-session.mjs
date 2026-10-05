import {indriSession,json} from './_indri-cgk-core.mjs';
export default async request=>{
  if(request.method!=='GET')return json({message:'Metode tidak diizinkan.'},405);
  const session=indriSession(request);
  if(!session)return json({ok:false},401);
  return json({ok:true,username:session.username,role:session.role,hub:'CGK',scope:'PTP'});
};
export const config={path:'/.netlify/functions/indri-cgk-session',method:'GET'};
