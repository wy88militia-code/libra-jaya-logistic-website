const $=id=>document.getElementById(id);
let routes=[],currentRoute=null,currentQuote=null;
let map=null,originMarker=null,destinationMarker=null,geocoder=null,mapsReady=false;
const DEFAULT_DJJ={lat:-2.576953,lng:140.516372};
let originPoint={...DEFAULT_DJJ};

const money=v=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(v)||0);
const clean=v=>String(v??'').trim();
const normalize=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function status(el,text,type=''){el.textContent=text;el.className=`status show ${type}`;}
function requireLogin(res){if(res.status===401){location.href='/partner/login.html?next=/partner/booking.html';return true;}return false;}
function same(a,b){return clean(a)===clean(b);}

function airportLabel(value){
 const raw=clean(value);const upper=raw.toUpperCase();
 if(upper.includes('WMX')||upper.includes('WAMENA'))return 'Bandara Wamena (WMX)';
 if(upper.includes('DJJ')||upper.includes('SENTANI')||upper.includes('DORTHEYS'))return 'Bandara Sentani (DJJ)';
 if(upper.includes('OKS')||upper.includes('OKSIBIL'))return 'Bandara Oksibil (OKS)';
 if(upper.includes('DEX')||upper.includes('DEKAI'))return 'Bandara Nop Goliat Dekai (DEX)';
 return raw||'Bandara acuan';
}
function airportQuery(value){
 const raw=clean(value);const upper=raw.toUpperCase();
 if(upper.includes('WMX')||upper.includes('WAMENA'))return 'Bandar Udara Wamena, Papua Pegunungan, Indonesia';
 if(upper.includes('DJJ')||upper.includes('SENTANI')||upper.includes('DORTHEYS'))return 'Bandar Udara Internasional Dortheys Hiyo Eluay, Sentani, Papua, Indonesia';
 if(upper.includes('OKS')||upper.includes('OKSIBIL'))return 'Bandar Udara Oksibil, Pegunungan Bintang, Papua Pegunungan, Indonesia';
 if(upper.includes('DEX')||upper.includes('DEKAI'))return 'Bandar Udara Nop Goliat Dekai, Yahukimo, Papua Pegunungan, Indonesia';
 return `${raw} airport, Indonesia`;
}

function sortRoutes(items){return [...items].sort((a,b)=>`${clean(a.hub)}|${clean(a.provinsi)}|${clean(a.kabupatenKota)}|${clean(a.distrik)}|${clean(a.kelurahan)}`.localeCompare(`${clean(b.hub)}|${clean(b.provinsi)}|${clean(b.kabupatenKota)}|${clean(b.distrik)}|${clean(b.kelurahan)}`,'id'));}
function unique(items,key){return [...new Set(items.map(r=>clean(r[key])).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id'));}
function resetSelect(id,placeholder){const select=$(id);select.replaceChildren();const option=document.createElement('option');option.value='';option.textContent=placeholder;select.append(option);select.disabled=true;}
function fillSelect(id,values,placeholder,labelFn=v=>v){
 const select=$(id);select.replaceChildren();const first=document.createElement('option');first.value='';first.textContent=placeholder;select.append(first);
 values.forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=labelFn(value);select.append(option);});
 select.disabled=!values.length;
 if(values.length===1)select.value=values[0];
 return values.length===1;
}
function resetQuoteAndGps(){currentRoute=null;currentQuote=null;$('refreshQuote').hidden=true;$('quoteStatus').className='status';$('quoteStatus').textContent='';renderDestination();resetGps();}
function routesByAirport(){return routes.filter(r=>same(r.hub,$('airport').value));}
function routesByProvince(){return routesByAirport().filter(r=>same(r.provinsi,$('province').value));}
function routesByCity(){return routesByProvince().filter(r=>same(r.kabupatenKota,$('city').value));}
function routesByDistrict(){return routesByCity().filter(r=>same(r.distrik,$('district').value));}

function populateProvince(){
 resetSelect('city','Pilih kabupaten/kota');resetSelect('district','Pilih kecamatan/distrik');resetSelect('village','Pilih kelurahan/kampung');resetQuoteAndGps();
 if(!$('airport').value){resetSelect('province','Pilih provinsi');return;}
 const auto=fillSelect('province',unique(routesByAirport(),'provinsi'),'Pilih provinsi');
 $('mapAirportLabel').textContent=airportLabel($('airport').value);resolveSelectedAirportOnMap();
 if(auto)populateCity();
}
function populateCity(){
 resetSelect('district','Pilih kecamatan/distrik');resetSelect('village','Pilih kelurahan/kampung');resetQuoteAndGps();
 if(!$('province').value){resetSelect('city','Pilih kabupaten/kota');return;}
 const auto=fillSelect('city',unique(routesByProvince(),'kabupatenKota'),'Pilih kabupaten/kota');if(auto)populateDistrict();
}
function populateDistrict(){
 resetSelect('village','Pilih kelurahan/kampung');resetQuoteAndGps();
 if(!$('city').value){resetSelect('district','Pilih kecamatan/distrik');return;}
 const auto=fillSelect('district',unique(routesByCity(),'distrik'),'Pilih kecamatan/distrik');if(auto)populateVillage();
}
function populateVillage(){
 resetQuoteAndGps();
 if(!$('district').value){resetSelect('village','Pilih kelurahan/kampung');return;}
 const auto=fillSelect('village',unique(routesByDistrict(),'kelurahan'),'Pilih kelurahan/kampung');if(auto)finalizeRoute();
}
function finalizeRoute(){
 currentRoute=routesByDistrict().find(r=>same(r.kelurahan,$('village').value))||null;currentQuote=null;$('refreshQuote').hidden=true;$('quoteStatus').className='status';$('quoteStatus').textContent='';renderDestination();resetGps();
}

async function loadRoutes(){
 try{
  const res=await fetch('/.netlify/functions/partner-routes');if(requireLogin(res))return;
  const data=await res.json();if(!res.ok)throw new Error(data.message||'Master rute gagal dimuat.');
  routes=sortRoutes(data.routes||[]);
  const auto=fillSelect('airport',unique(routes,'hub'),'Pilih bandara acuan',airportLabel);if(auto)populateProvince();
 }catch(e){
  resetSelect('airport','Master rute tidak tersedia');status($('quoteStatus'),e.message,'err');
 }
}

function renderDestination(){
 if(!currentRoute){$('destinationSummary').classList.add('hidden');$('gpsTargetArea').textContent='Belum dipilih';$('gpsTargetRegion').textContent='Pilih tujuan pada langkah 1.';$('confirmKelLabel').textContent='kelurahan tujuan';return;}
 $('destinationSummary').classList.remove('hidden');
 $('selectedKelurahan').textContent=clean(currentRoute.kelurahan)||'—';
 $('selectedRouteCode').textContent=clean(currentRoute.kodeRute)||'RUTE';
 $('selectedAirport').textContent=airportLabel(currentRoute.hub);
 $('selectedProvince').textContent=clean(currentRoute.provinsi)||'—';
 $('selectedCity').textContent=clean(currentRoute.kabupatenKota)||'—';
 $('selectedDistrict').textContent=clean(currentRoute.distrik)||'—';
 $('selectedVillage').textContent=clean(currentRoute.kelurahan)||'—';
 $('mapAirportLabel').textContent=airportLabel(currentRoute.hub);
 $('gpsTargetArea').textContent=clean(currentRoute.kelurahan)||'—';
 $('gpsTargetRegion').textContent=`${clean(currentRoute.distrik)||'—'}, ${clean(currentRoute.kabupatenKota)||'—'} • ${airportLabel(currentRoute.hub)}`;
 $('confirmKelLabel').textContent=`${clean(currentRoute.kelurahan)||'kelurahan tujuan'}, ${clean(currentRoute.distrik)||'—'}`;
 resolveSelectedAirportOnMap();
}

function resetGps(){
 $('lat').value='';$('lng').value='';$('accuracy').value='';$('confirmedArea').value='';$('confirmKel').checked=false;
 $('latDisplay').textContent='—';$('lngDisplay').textContent='—';$('accuracyDisplay').textContent='—';
 $('detectedAddress').textContent='Belum ada titik GPS.';$('areaMatchStatus').textContent='Kelurahan pilihan tetap menjadi acuan utama.';
 $('detectedAddress').parentElement.classList.remove('match','warn');
 $('gpsStatus').className='status';$('gpsStatus').textContent='';
 if(destinationMarker)destinationMarker.setMap(null);destinationMarker=null;
 if(map&&mapsReady){map.setCenter(originPoint);map.setZoom(11);}
 refreshBookingButton();
}

function gpsIsValid(){const accuracy=Number($('accuracy').value);return Number.isFinite(Number($('lat').value))&&Number.isFinite(Number($('lng').value))&&accuracy>0&&accuracy<=200;}
function refreshBookingButton(){const approved=currentQuote?.status==='APPROVED';$('bookingBtn').disabled=!(approved&&currentRoute&&gpsIsValid()&&$('confirmKel').checked);}

$('airport').addEventListener('change',populateProvince);
$('province').addEventListener('change',populateCity);
$('city').addEventListener('change',populateDistrict);
$('district').addEventListener('change',populateVillage);
$('village').addEventListener('change',finalizeRoute);
$('confirmKel').addEventListener('change',refreshBookingButton);

$('quoteBtn').addEventListener('click',async()=>{
 const weight=Number($('weight').value);
 if(!currentRoute||!weight){status($('quoteStatus'),'Lengkapi Bandara Acuan sampai Kelurahan/Kampung, lalu isi berat kiriman.','err');return;}
 status($('quoteStatus'),'Meminta quote…');
 try{
  const res=await fetch('/.netlify/functions/partner-quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kodeRute:currentRoute.kodeRute,weightKg:weight})});if(requireLogin(res))return;
  const data=await res.json();if(!res.ok)throw new Error(data.message||'Quote gagal.');currentQuote=data.quote;$('refreshQuote').hidden=false;renderQuote();
 }catch(e){status($('quoteStatus'),e.message,'err');}
});

function renderQuote(){
 if(!currentQuote)return;
 const approved=currentQuote.status==='APPROVED';
 const detail=`${currentQuote.quoteId} • ${airportLabel(currentRoute?.hub)} • ${currentQuote.kelurahan}, ${currentQuote.distrik}${currentRoute?.kabupatenKota?' • '+currentRoute.kabupatenKota:''} • ${currentQuote.weightKg} kg${currentQuote.sla?' • SLA '+currentQuote.sla:''}`;
 status($('quoteStatus'),approved?`APPROVED — ${money(currentQuote.amount)} — ${detail}`:`${currentQuote.status} — ${detail}. Menunggu approval Admin Libra sebelum booking.`,approved?'ok':'');refreshBookingButton();
}

$('refreshQuote').addEventListener('click',async()=>{
 if(!currentQuote)return;
 try{const res=await fetch('/.netlify/functions/partner-quote-status?quoteId='+encodeURIComponent(currentQuote.quoteId));if(requireLogin(res))return;const data=await res.json();if(!res.ok)throw new Error(data.message||'Gagal membaca quote.');currentQuote=data.quote;renderQuote();}catch(e){status($('quoteStatus'),e.message,'err');}
});

function loadGoogleMaps(apiKey){
 if(window.google?.maps)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const existing=document.querySelector('script[data-libra-google-maps]');if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true});return;}
  const script=document.createElement('script');script.dataset.libraGoogleMaps='1';script.async=true;script.defer=true;script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&language=id&region=ID&v=weekly`;script.onload=resolve;script.onerror=()=>reject(new Error('Google Maps JavaScript gagal dimuat.'));document.head.append(script);
 });
}

async function initMaps(){
 try{
  const res=await fetch('/maps/browser-config',{cache:'no-store'});const data=await res.json();if(!res.ok||!data.configured||!data.apiKey)return;
  await loadGoogleMaps(data.apiKey);
  const canvas=$('mapCanvas');canvas.replaceChildren();
  map=new google.maps.Map(canvas,{center:originPoint,zoom:11,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,gestureHandling:'cooperative'});
  geocoder=new google.maps.Geocoder();mapsReady=true;await resolveSelectedAirportOnMap();
 }catch(e){
  const placeholder=$('mapPlaceholder');if(placeholder){placeholder.querySelector('small').textContent='Peta belum dapat dimuat. GPS booking tetap dapat digunakan.';}
 }
}

function resolveSelectedAirportOnMap(){
 if(!mapsReady||!geocoder)return Promise.resolve();
 const selected=$('airport').value;if(!selected){originPoint={...DEFAULT_DJJ};return Promise.resolve();}
 const label=airportLabel(selected);$('mapAirportLabel').textContent=label;
 return new Promise(resolve=>{
  geocoder.geocode({address:airportQuery(selected)},(results,gStatus)=>{
   if(gStatus==='OK'&&results?.length){const loc=results[0].geometry.location;originPoint={lat:loc.lat(),lng:loc.lng()};}
   else if(label.includes('(DJJ)'))originPoint={...DEFAULT_DJJ};
   if(originMarker)originMarker.setMap(null);
   originMarker=new google.maps.Marker({map,position:originPoint,title:label,label:{text:(label.match(/\(([A-Z]{3})\)/)||[])[1]||'HUB',fontWeight:'700',fontSize:'10px'}});
   if(!destinationMarker){map.setCenter(originPoint);map.setZoom(11);}resolve();
  });
 });
}

function showDestinationOnMap(point){
 if(!map||!mapsReady)return;
 if(destinationMarker)destinationMarker.setMap(null);
 destinationMarker=new google.maps.Marker({map,position:point,title:`Titik penerima — ${clean(currentRoute?.kelurahan)||'tujuan'}`});
 const bounds=new google.maps.LatLngBounds();bounds.extend(originPoint);bounds.extend(point);map.fitBounds(bounds,70);
 google.maps.event.addListenerOnce(map,'idle',()=>{if(map.getZoom()>15)map.setZoom(15);});
}

function googleResultMatchesRoute(result){
 if(!result||!currentRoute)return false;
 const parts=[result.formatted_address,...(result.address_components||[]).flatMap(c=>[c.long_name,c.short_name])];
 const hay=normalize(parts.join(' '));const village=normalize(currentRoute.kelurahan);const district=normalize(currentRoute.distrik);
 return Boolean(village&&hay.includes(village)&&(district?hay.includes(district)||hay.includes(normalize(currentRoute.kabupatenKota)):true));
}

function reverseGeocode(point){
 if(!geocoder)return;
 geocoder.geocode({location:point},(results,gStatus)=>{
  if(gStatus!=='OK'||!results?.length){$('detectedAddress').textContent='Alamat Google tidak tersedia untuk titik ini.';$('areaMatchStatus').textContent='Konfirmasi kelurahan Master Libra secara manual.';return;}
  const result=results[0];const match=googleResultMatchesRoute(result);const box=$('detectedAddress').parentElement;
  $('detectedAddress').textContent=result.formatted_address||'Alamat Google tersedia.';
  box.classList.remove('match','warn');box.classList.add(match?'match':'warn');
  $('areaMatchStatus').textContent=match?`Google mendeteksi area yang konsisten dengan ${clean(currentRoute.kelurahan)}.`:`Google belum memastikan nama ${clean(currentRoute.kelurahan)} pada alamat ini. Periksa titik dan konfirmasi kelurahan secara manual.`;
 });
}

$('gpsBtn').addEventListener('click',()=>{
 if(!currentRoute){status($('gpsStatus'),'Lengkapi Bandara Acuan, Provinsi, Kab/Kota, Kecamatan/Distrik, dan Kelurahan/Kampung terlebih dahulu.','err');return;}
 if(!navigator.geolocation){status($('gpsStatus'),'Perangkat tidak mendukung GPS browser.','err');return;}
 status($('gpsStatus'),'Mengambil GPS presisi…');
 navigator.geolocation.getCurrentPosition(pos=>{
  const c=pos.coords;const point={lat:c.latitude,lng:c.longitude};const accuracy=Math.round(c.accuracy);
  $('lat').value=c.latitude.toFixed(7);$('lng').value=c.longitude.toFixed(7);$('accuracy').value=String(accuracy);$('confirmedArea').value=`${airportLabel(currentRoute.hub)} | ${clean(currentRoute.provinsi)} | ${clean(currentRoute.kabupatenKota)} | ${clean(currentRoute.distrik)} | ${clean(currentRoute.kelurahan)}`;
  $('latDisplay').textContent=c.latitude.toFixed(6);$('lngDisplay').textContent=c.longitude.toFixed(6);$('accuracyDisplay').textContent=`${accuracy} m`;
  $('confirmKel').checked=false;refreshBookingButton();showDestinationOnMap(point);reverseGeocode(point);
  if(accuracy>200)status($('gpsStatus'),`Akurasi GPS ${accuracy} m. Harus 200 m atau lebih baik. Coba di area terbuka dan ambil ulang GPS.`,'err');
  else status($('gpsStatus'),`GPS terkunci pada ${clean(currentRoute.kelurahan)}. Akurasi ${accuracy} m. Cocokkan titik pada peta lalu centang konfirmasi.`,'ok');
 },err=>status($('gpsStatus'),'GPS gagal: '+err.message,'err'),{enableHighAccuracy:true,timeout:15000,maximumAge:0});
});

$('bookingBtn').addEventListener('click',async()=>{
 if(!currentQuote||currentQuote.status!=='APPROVED'){status($('bookingStatus'),'Quote belum APPROVED.','err');return;}
 if(!currentRoute){status($('bookingStatus'),'Kelurahan tujuan belum dipilih.','err');return;}
 const lat=Number($('lat').value),lng=Number($('lng').value),accuracy=Number($('accuracy').value);
 if(!$('confirmKel').checked||!Number.isFinite(lat)||!Number.isFinite(lng)||!accuracy||accuracy>200){status($('bookingStatus'),'Kelurahan dan GPS tujuan wajib valid serta dikonfirmasi.','err');return;}
 const payload={quoteId:currentQuote.quoteId,idempotencyKey:crypto.randomUUID(),partnerReference:$('partnerRef').value,sender:{name:$('senderName').value,phone:$('senderPhone').value,address:$('senderAddress').value},recipient:{name:$('recipientName').value,phone:$('recipientPhone').value,address:$('recipientAddress').value},destination:{kodeWilayah:currentRoute.kodeWilayah,latitude:lat,longitude:lng,accuracyMeters:accuracy,confirmedKelurahan:true}};
 status($('bookingStatus'),'Membuat booking…');$('bookingBtn').disabled=true;
 try{
  const res=await fetch('/.netlify/functions/partner-booking-create',{method:'POST',headers:{'content-type':'application/json','idempotency-key':payload.idempotencyKey},body:JSON.stringify(payload)});if(requireLogin(res))return;
  const data=await res.json();if(res.status===402){status($('bookingStatus'),`${data.message} Booking ID: ${data.bookingId||'—'}. Saldo: ${money(data.balance)}. Silakan top-up di menu Saldo.`,'err');return;}
  if(!res.ok)throw new Error(data.message||'Booking gagal.');status($('bookingStatus'),`Booking berhasil: ${data.booking.bookingId}. ${airportLabel(currentRoute.hub)} → ${clean(currentRoute.kelurahan)}, ${clean(currentRoute.distrik)}. Saldo tersisa ${money(data.balance)}.`,'ok');currentQuote.status='BOOKED';
 }catch(e){status($('bookingStatus'),e.message,'err');}
 finally{refreshBookingButton();}
});

renderDestination();loadRoutes();initMaps();
