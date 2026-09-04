import { mapsConfigStatus } from './_maps-core.mjs';

export default async request=>{
 if(request.method!=='GET')return Response.json({message:'Metode tidak diizinkan.'},{status:405});
 const status=mapsConfigStatus();
 return Response.json({configured:status.browserConfigured,apiKey:status.browserConfigured?String(process.env.GOOGLE_MAPS_BROWSER_API_KEY):null},{headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}});
};
export const config={path:'/maps/browser-config'};
