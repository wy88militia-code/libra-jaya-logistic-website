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

function destinationQuery(destination={}){
 const explicit=clean(destination.tujuanMaps||destination.query);
 if(explicit)return explicit;
 return [destination.kelurahan,destination.distrik,destination.kabupatenKota,destination.provinsi,'Indonesia'].map(clean).filter(Boolean).join(', ');
}

export async function testMapsConnection(destination={}){
 const key=clean(process.env.GOOGLE_MAPS_SERVER_API_KEY);if(key.length<20)throw new Error('GOOGLE_MAPS_SERVER_API_KEY belum dikonfigurasi.');
 const query=destinationQuery(destination);if(!query)throw new Error('Pilih Kelurahan/Kampung tujuan dari Master Libra terlebih dahulu.');
 const origin={latitude:-2.576953,longitude:140.516372};
 const geocodeUrl=new URL('https://maps.googleapis.com/maps/api/geocode/json');
 geocodeUrl.searchParams.set('address',query);geocodeUrl.searchParams.set('language','id');geocodeUrl.searchParams.set('region','id');geocodeUrl.searchParams.set('key',key);
 const geocode=await googleJson(geocodeUrl);
 if(geocode.status!=='OK'||!geocode.results?.length)throw new Error(`Geocoding tujuan gagal: ${geocode.status||'tidak ada hasil'} — ${query}`);
 const first=geocode.results[0];const lat=Number(first.geometry?.location?.lat),lng=Number(first.geometry?.location?.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng))throw new Error('Google Geocoding tidak mengembalikan koordinat tujuan yang valid.');
 const target={latitude:lat,longitude:lng};
 const routes=await googleJson('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key,'x-goog-fieldmask':'routes.distanceMeters,routes.duration'},body:JSON.stringify({origin:{location:{latLng:origin}},destination:{location:{latLng:target}},travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',languageCode:'id-ID',units:'METRIC'})});
 if(!routes.routes?.length)throw new Error(`Geocoding tujuan PASS, tetapi Routes DRIVE tidak menemukan jalur Bandara Sentani ke ${clean(destination.kelurahan)||query}. Untuk rute connecting flight, uji jarak darat dilakukan pada segmen last-mile hub tujuan.`);
 const route=routes.routes[0];
 const label=[clean(destination.kelurahan),clean(destination.distrik)&&`Distrik ${clean(destination.distrik)}`,clean(destination.kabupatenKota)].filter(Boolean).join(', ');
 return {
  testedAt:new Date().toISOString(),
  destination:{kodeRute:clean(destination.kodeRute),kodeWilayah:clean(destination.kodeWilayah),kelurahan:clean(destination.kelurahan),distrik:clean(destination.distrik),kabupatenKota:clean(destination.kabupatenKota),query},
  geocoding:{status:'PASS',address:first.formatted_address,latitude:lat,longitude:lng,locationType:clean(first.geometry?.location_type)||null},
  routes:{status:'PASS',distanceMeters:route.distanceMeters,duration:route.duration},
  testRoute:`Bandara Sentani (DJJ) → ${label||query}`,
 };
}
