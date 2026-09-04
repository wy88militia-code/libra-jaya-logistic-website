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

function airportInfo(destination={}){
 const raw=clean(destination.hub||destination.bandaraAsal||'DJJ');
 const upper=raw.toUpperCase();
 if(upper.includes('WMX')||upper.includes('WAMENA'))return {code:'WMX',label:'Bandara Wamena (WMX)',query:'Bandar Udara Wamena, Papua Pegunungan, Indonesia'};
 if(upper.includes('DJJ')||upper.includes('SENTANI')||upper.includes('DORTHEYS'))return {code:'DJJ',label:'Bandara Sentani (DJJ)',query:'Bandar Udara Internasional Dortheys Hiyo Eluay, Sentani, Papua, Indonesia'};
 if(upper.includes('OKS')||upper.includes('OKSIBIL'))return {code:'OKS',label:'Bandara Oksibil (OKS)',query:'Bandar Udara Oksibil, Pegunungan Bintang, Papua Pegunungan, Indonesia'};
 if(upper.includes('DEX')||upper.includes('DEKAI'))return {code:'DEX',label:'Bandara Nop Goliat Dekai (DEX)',query:'Bandar Udara Nop Goliat Dekai, Yahukimo, Papua Pegunungan, Indonesia'};
 return {code:raw,label:raw,query:`${raw} airport, Indonesia`};
}

async function geocodeAddress(key,query,label){
 const url=new URL('https://maps.googleapis.com/maps/api/geocode/json');
 url.searchParams.set('address',query);url.searchParams.set('language','id');url.searchParams.set('region','id');url.searchParams.set('key',key);
 const data=await googleJson(url);
 if(data.status!=='OK'||!data.results?.length)throw new Error(`Geocoding ${label} gagal: ${data.status||'tidak ada hasil'} — ${query}`);
 const first=data.results[0];const latitude=Number(first.geometry?.location?.lat),longitude=Number(first.geometry?.location?.lng);
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude))throw new Error(`Google Geocoding tidak mengembalikan koordinat ${label} yang valid.`);
 return {first,latitude,longitude};
}

export async function testMapsConnection(destination={}){
 const key=clean(process.env.GOOGLE_MAPS_SERVER_API_KEY);if(key.length<20)throw new Error('GOOGLE_MAPS_SERVER_API_KEY belum dikonfigurasi.');
 const targetQuery=destinationQuery(destination);if(!targetQuery)throw new Error('Pilih Kelurahan/Kampung tujuan dari Master Libra terlebih dahulu.');
 const airport=airportInfo(destination);
 const [originGeo,targetGeo]=await Promise.all([
  geocodeAddress(key,airport.query,'bandara acuan'),
  geocodeAddress(key,targetQuery,'tujuan'),
 ]);
 const origin={latitude:originGeo.latitude,longitude:originGeo.longitude};
 const target={latitude:targetGeo.latitude,longitude:targetGeo.longitude};
 const routes=await googleJson('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key,'x-goog-fieldmask':'routes.distanceMeters,routes.duration'},body:JSON.stringify({origin:{location:{latLng:origin}},destination:{location:{latLng:target}},travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',languageCode:'id-ID',units:'METRIC'})});
 if(!routes.routes?.length)throw new Error(`Geocoding PASS, tetapi Routes DRIVE tidak menemukan jalur ${airport.label} ke ${clean(destination.kelurahan)||targetQuery}. Pastikan bandara acuan sesuai segmen last-mile.`);
 const route=routes.routes[0];
 const label=[clean(destination.kelurahan),clean(destination.distrik)&&`Distrik ${clean(destination.distrik)}`,clean(destination.kabupatenKota)].filter(Boolean).join(', ');
 return {
  testedAt:new Date().toISOString(),
  airport:{code:airport.code,label:airport.label,address:originGeo.first.formatted_address,latitude:origin.latitude,longitude:origin.longitude},
  destination:{kodeRute:clean(destination.kodeRute),kodeWilayah:clean(destination.kodeWilayah),provinsi:clean(destination.provinsi),kelurahan:clean(destination.kelurahan),distrik:clean(destination.distrik),kabupatenKota:clean(destination.kabupatenKota),query:targetQuery},
  geocoding:{status:'PASS',address:targetGeo.first.formatted_address,latitude:target.latitude,longitude:target.longitude,locationType:clean(targetGeo.first.geometry?.location_type)||null},
  routes:{status:'PASS',distanceMeters:route.distanceMeters,duration:route.duration},
  testRoute:`${airport.label} → ${label||targetQuery}`,
 };
}
