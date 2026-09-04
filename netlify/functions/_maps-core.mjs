const clean=value=>String(value||'').trim();

export function mapsConfigStatus(){
 const browserKey=clean(process.env.GOOGLE_MAPS_BROWSER_API_KEY);
 const serverKey=clean(process.env.GOOGLE_MAPS_SERVER_API_KEY);
 return {browserConfigured:browserKey.length>=20,serverConfigured:serverKey.length>=20,configured:browserKey.length>=20&&serverKey.length>=20};
}

async function googleJson(url,options={}){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch(url,{...options,signal:controller.signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error?.message||`Google Maps HTTP ${response.status}`);
  return data;
 }finally{clearTimeout(timer);}
}

export async function testMapsConnection(){
 const key=clean(process.env.GOOGLE_MAPS_SERVER_API_KEY);if(key.length<20)throw new Error('GOOGLE_MAPS_SERVER_API_KEY belum dikonfigurasi.');
 const origin={latitude:-2.576953,longitude:140.516372};
 const destination={latitude:-2.53371,longitude:140.71813};
 const geocodeUrl=new URL('https://maps.googleapis.com/maps/api/geocode/json');
 geocodeUrl.searchParams.set('latlng',`${origin.latitude},${origin.longitude}`);geocodeUrl.searchParams.set('language','id');geocodeUrl.searchParams.set('key',key);
 const [geocode,routes]=await Promise.all([
  googleJson(geocodeUrl),
  googleJson('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key,'x-goog-fieldmask':'routes.distanceMeters,routes.duration'},body:JSON.stringify({origin:{location:{latLng:origin}},destination:{location:{latLng:destination}},travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',languageCode:'id-ID',units:'METRIC'})})
 ]);
 if(geocode.status!=='OK'||!geocode.results?.length)throw new Error(`Geocoding API: ${geocode.status||'tidak ada hasil'}`);
 if(!routes.routes?.length)throw new Error('Routes API tidak mengembalikan rute uji.');
 const route=routes.routes[0];
 return {testedAt:new Date().toISOString(),geocoding:{status:'PASS',address:geocode.results[0].formatted_address},routes:{status:'PASS',distanceMeters:route.distanceMeters,duration:route.duration},testRoute:'Bandara Sentani → Jayapura'};
}
