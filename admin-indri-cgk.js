const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const loaForm=$("#loa-form"),loaStatus=$("#loa-status"),loaResult=$("#loa-result"),packageRows=$("#package-rows");
const customerDialog=$("#customer-dialog"),customerForm=$("#customer-form"),customerStatus=$("#customer-status");
const workflowDialog=$("#workflow-dialog"),workflowForm=$("#workflow-form"),workflowFields=$("#workflow-fields"),workflowStatus=$("#workflow-status");
const masterDialog=$("#master-dialog"),masterForm=$("#master-form"),masterStatus=$("#master-status");
let customers=[],shippers=[],consignees=[],routes=[],flow={loas:[],invoices:[],summary:{}};

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=v=>"Rp "+Math.round(Number(v)||0).toLocaleString("id-ID");
const date=v=>v?new Date(v).toLocaleDateString("id-ID"):"-";
const statusLabel=s=>String(s||"-").replaceAll("_"," ");
async function api(url,options={}){
  const res=await fetch(url,{cache:"no-store",...options});
  const data=await res.json().catch(()=>({message:"Respons server tidak valid."}));
  if(res.status===401){window.location.assign("/jlx-soetta-login.html?next="+encodeURIComponent("/admin-indri-cgk"));throw new Error("Sesi berakhir.")}
  if(!res.ok)throw new Error(data.message||"Permintaan gagal.");
  return data;
}

(async function boot(){
  try{
    const r=await fetch("/.netlify/functions/indri-cgk-session",{cache:"no-store"});
    if(!r.ok){window.location.replace("/jlx-soetta-login.html?next="+encodeURIComponent("/admin-indri-cgk"));return}
    await loadAll();
  }catch(e){alert(e.message||String(e))}
})();
$$(".tab").forEach(btn=>btn.addEventListener("click",()=>showPanel(btn.dataset.panel)));
function showPanel(name){
  $$(".tab").forEach(x=>x.classList.toggle("active",x.dataset.panel===name));
  $$(".workspace").forEach(x=>x.classList.toggle("active",x.dataset.workspace===name));
}

async function loadAll(){
  const [c,p,r,w]=await Promise.all([
    api("/.netlify/functions/indri-cgk-customers"),
    api("/.netlify/functions/indri-cgk-parties"),
    api("/.netlify/functions/indri-cgk-routes"),
    api("/.netlify/functions/indri-cgk-workflow")
  ]);
  customers=c.items||[];shippers=p.shippers||[];consignees=p.consignees||[];
  routes=r.items||[];
  flow=w;
  renderAll();
}
function renderAll(){
  renderKpis();renderCustomers();renderParties();renderSelects();renderRoutes();renderStock();renderFlow();renderFinance();renderAlerts();renderPackageRows();
}
function renderKpis(){
  $("#kpi-customer").textContent=flow.summary?.customerCount||0;
  $("#kpi-approval").textContent=flow.summary?.pendingApproval||0;
  $("#kpi-stock").textContent=flow.summary?.stock?.activeShipments||0;
  $("#kpi-stock-pieces").textContent=flow.summary?.stock?.pieces||0;
  $("#kpi-stock-kg").textContent=(Number(flow.summary?.stock?.weightKg)||0).toLocaleString("id-ID",{maximumFractionDigits:2})+" kg";
  $("#kpi-invoice").textContent=flow.summary?.unpaidInvoice||0;
  $("#kpi-ar").textContent=money(flow.summary?.totalReceivable||0);
}
function renderAlerts(){
  const box=$("#dashboard-alerts"),items=[];
  const expired=customers.filter(x=>x.active!==false&&x.pksStatus!=="ACTIVE");
  if(expired.length)items.push(`<article class="alert-card warn"><b>${expired.length} customer belum memiliki PKS ACTIVE.</b><span>LoA baru untuk customer tersebut akan diblok.</span></article>`);
  const over=customers.filter(x=>x.paymentScheme==="CREDIT"&&Number(x.finance?.availableCredit||0)<=0);
  if(over.length)items.push(`<article class="alert-card danger"><b>${over.length} customer kredit tanpa sisa plafond.</b><span>Approval LoA kredit baru akan ditolak sampai saldo tersedia.</span></article>`);
  if(!items.length)items.push('<article class="alert-card ok"><b>Kontrol utama normal.</b><span>Tidak ada warning PKS/plafond dari data saat ini.</span></article>');
  box.innerHTML=items.join("");
}

function renderCustomers(){
  const byId=new Map((flow.customers||[]).map(x=>[x.id,x]));
  const box=$("#customer-list");
  if(!customers.length){box.innerHTML='<p class="preview">Belum ada Master PT Pengirim / PKS.</p>';return}
  box.innerHTML=customers.map(x=>{
    const live=byId.get(x.id)||x,fin=live.finance||{};
    const pksButtons=[
      '<button class="secondary edit-customer" data-id="'+esc(x.id)+'">Edit Master</button>',
      x.pksDraftId?'<a class="button ghost" href="'+esc(x.pksDraftPdfUrl||"#")+'" target="_blank" rel="noopener">Buka Draft PKS</a>':'<button class="primary pks-action" data-action="GENERATE" data-id="'+esc(x.id)+'">Buat Draft PKS</button>',
      x.pksDraftId&&x.pksStatus==="DRAFT"?'<button class="secondary pks-action" data-action="REGENERATE" data-id="'+esc(x.id)+'">Regenerate Draft</button>':"",
      x.pksStatus==="DRAFT"&&x.pksDraftId?'<button class="primary pks-action" data-action="SET_REVIEW" data-id="'+esc(x.id)+'">Masuk Review</button>':"",
      x.pksStatus==="REVIEW"?'<button class="primary pks-action" data-action="READY_FOR_PRIVY" data-id="'+esc(x.id)+'">Siap untuk Privy</button>':"",
      x.pksStatus==="READY_FOR_PRIVY"?'<span class="paid-badge">READY FOR PRIVY</span>':""
    ].join("");
    return `<article class="master-card ${x.active===false?"inactive":""}">
      <div><h3>${esc(x.legalName)}</h3>
      <p><b>${esc(x.customerCode||"-")}</b>${x.tradeName?" · "+esc(x.tradeName):""} · PIC ${esc(x.pic||"-")}</p>
      <p>PKS <b>${esc(x.pksNumber||"-")}</b> · <span class="pill ${x.pksStatus==="ACTIVE"?"good":"warn"}">${esc(x.pksStatus)}</span> · ${esc(x.paymentScheme)}</p>
      <p>${x.paymentScheme==="DP"?`DP ${Number(x.dpPercent)||0}%`:x.paymentScheme==="CREDIT"?`Plafond ${money(x.creditLimit)} · termin ${Number(x.creditDays)||0} hari`:"Cash"}</p>
      <p class="meta">Penandatangan: ${esc(x.signatoryName||x.pic||"-")} · ${esc(x.signatoryTitle||"belum ditentukan")} · Draft V${Number(x.pksDraftVersion)||0}</p>
      <p class="meta">Piutang: <b>${money(fin.outstanding||0)}</b> · Komitmen belum invoice: ${money(fin.committed||0)}${x.paymentScheme==="CREDIT"?` · Sisa plafond: <b>${money(fin.availableCredit||0)}</b>`:""}</p></div>
      <div class="card-actions">${pksButtons}</div>
    </article>`;
  }).join("");
  $$(".edit-customer").forEach(b=>b.addEventListener("click",()=>openCustomer(b.dataset.id)));
  $$(".pks-action").forEach(b=>b.addEventListener("click",()=>pksAction(b.dataset.action,b.dataset.id)));
}
async function pksAction(action,customerId){
  const label={GENERATE:"membuat draft PKS",REGENERATE:"membuat ulang draft PKS",SET_REVIEW:"memindahkan PKS ke REVIEW",READY_FOR_PRIVY:"menandai PKS READY_FOR_PRIVY"}[action]||"memproses PKS";
  try{
    const d=await api("/.netlify/functions/indri-cgk-pks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,customerId})});
    await loadAll();
    if(d.item?.pdfUrl&&(action==="GENERATE"||action==="REGENERATE"))window.open(d.item.pdfUrl,"_blank","noopener");
  }catch(err){alert("Gagal "+label+": "+(err.message||String(err)))}
}
$("#add-customer").addEventListener("click",()=>openCustomer(""));
function openCustomer(id){
  customerForm.reset();customerStatus.textContent="";customerForm.elements.id.value=id;customerForm.elements.active.checked=true;
  const x=customers.find(v=>v.id===id);$("#customer-title").textContent=x?"Edit PT & PKS":"Tambah PT & PKS";
  if(x){
    ["customerCode","legalName","tradeName","nib","npwp","pic","phone","email","signatoryName","signatoryTitle","address","pksNumber","pksDate","pksValidUntil","pksStatus","paymentScheme","dpPercent","creditLimit","creditDays","notes"].forEach(k=>customerForm.elements[k].value=x[k]??"");
    customerForm.elements.active.checked=x.active!==false;
  } else {customerForm.elements.pksStatus.value="DRAFT";customerForm.elements.paymentScheme.value="CASH";}
  customerDialog.showModal();
}
customerForm.addEventListener("submit",async e=>{
  e.preventDefault();if(e.submitter?.value==="cancel"){customerDialog.close();return}
  const b=Object.fromEntries(new FormData(customerForm));b.active=customerForm.elements.active.checked;
  b.dpPercent=Number(b.dpPercent)||0;b.creditLimit=Number(b.creditLimit)||0;b.creditDays=Number(b.creditDays)||0;
  customerStatus.textContent="Menyimpan…";
  try{
    await api("/.netlify/functions/indri-cgk-customers",{method:b.id?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});
    customerDialog.close();await loadAll();
  }catch(err){customerStatus.textContent=err.message||String(err)}
});

function renderParties(){
  renderPartyList("SHIPPER",shippers,$("#shipper-list"));renderPartyList("CONSIGNEE",consignees,$("#consignee-list"));
}
function renderPartyList(type,items,box){
  if(!items.length){box.innerHTML='<p class="preview">Belum ada data master.</p>';return}
  box.innerHTML=items.map(x=>`<article class="master-card ${x.active===false?"inactive":""}"><div><h3>${esc(x.name)}</h3><p><b>${esc(x.code||"-")}</b>${x.company?" · "+esc(x.company):""}${x.pic?" · PIC "+esc(x.pic):""}</p><p>${esc(x.phone)} · ${esc(x.address)}</p><p class="meta">Bandara: ${esc(x.airport||"-")} · ${x.active===false?"NONAKTIF":"AKTIF"}</p></div><div class="card-actions"><button class="secondary edit-master" data-type="${type}" data-id="${esc(x.id)}">Edit</button></div></article>`).join("");
  box.querySelectorAll(".edit-master").forEach(b=>b.addEventListener("click",()=>openMaster(b.dataset.type,b.dataset.id)));
}
$$(".add-master").forEach(b=>b.addEventListener("click",()=>openMaster(b.dataset.type)));
function openMaster(type,id=""){
  masterForm.reset();masterStatus.textContent="";masterForm.elements.type.value=type;masterForm.elements.id.value=id;masterForm.elements.active.checked=true;
  $("#master-title").textContent=type==="SHIPPER"?"Master Pengirim":"Master Konsinyi";
  if(type==="SHIPPER")masterForm.elements.airport.value="CGK";
  const x=(type==="SHIPPER"?shippers:consignees).find(v=>v.id===id);
  if(x){["code","name","company","pic","phone","email","province","city","district","village","postalCode","airport","address","notes"].forEach(k=>masterForm.elements[k].value=x[k]||"");masterForm.elements.active.checked=x.active!==false}
  masterDialog.showModal();
}
masterForm.addEventListener("submit",async e=>{
  e.preventDefault();if(e.submitter?.value==="cancel"){masterDialog.close();return}
  const b=Object.fromEntries(new FormData(masterForm));b.active=masterForm.elements.active.checked;
  masterStatus.textContent="Menyimpan…";
  try{await api("/.netlify/functions/indri-cgk-parties",{method:b.id?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});masterDialog.close();await loadAll()}
  catch(err){masterStatus.textContent=err.message||String(err)}
});

function renderSelects(){
  const cs=customers.filter(x=>x.active!==false&&x.pksStatus==="ACTIVE");
  loaForm.elements.customerId.innerHTML='<option value="">Pilih customer</option>'+cs.map(x=>`<option value="${esc(x.id)}">${esc(x.customerCode||"-")} · ${esc(x.legalName)} · ${esc(x.paymentScheme)}</option>`).join("");
  loaForm.elements.shipperId.innerHTML='<option value="">Pilih pengirim</option>'+shippers.filter(x=>x.active!==false).map(x=>`<option value="${esc(x.id)}">${esc(x.code||"-")} · ${esc(x.name)}</option>`).join("");
  loaForm.elements.consigneeId.innerHTML='<option value="">Pilih konsinyi</option>'+consignees.filter(x=>x.active!==false).map(x=>`<option value="${esc(x.id)}">${esc(x.code||"-")} · ${esc(x.name)}${x.city?" · "+esc(x.city):""}</option>`).join("");
}
function renderRoutes(){
  loaForm.elements.destinationAirport.innerHTML='<option value="">Pilih tujuan</option>'+routes.map(x=>`<option value="${esc(x.code)}">${esc(x.name)} (${esc(x.code)})</option>`).join("");
}
loaForm.elements.customerId.addEventListener("change",()=>{
  const x=customers.find(v=>v.id===loaForm.elements.customerId.value),box=$("#customer-preview");
  if(!x){box.textContent="Pilih PT Pengirim / Customer untuk melihat PKS dan skema pembayaran.";return}
  box.innerHTML=`<b>${esc(x.legalName)}</b> · PKS ${esc(x.pksNumber||"-")} · <b>${esc(x.paymentScheme)}</b>${x.paymentScheme==="DP"?` · DP ${Number(x.dpPercent)||0}%`:""}${x.paymentScheme==="CREDIT"?` · Plafond ${money(x.creditLimit)} · ${Number(x.creditDays)||0} hari`:""}`;
});
loaForm.elements.shipperId.addEventListener("change",()=>previewParty("SHIPPER"));
loaForm.elements.consigneeId.addEventListener("change",()=>previewParty("CONSIGNEE"));
function previewParty(type){
  const sel=loaForm.elements[type==="SHIPPER"?"shipperId":"consigneeId"],arr=type==="SHIPPER"?shippers:consignees,x=arr.find(v=>v.id===sel.value),box=$(type==="SHIPPER"?"#shipper-preview":"#consignee-preview");
  if(!x){box.textContent="Belum dipilih.";return}
  box.innerHTML=`<b>${esc(x.name)}</b>${x.company?" · "+esc(x.company):""}<br>${esc(x.phone)}${x.pic?" · PIC "+esc(x.pic):""}<br>${esc(x.address)}${x.city?", "+esc(x.city):""}`;
  if(type==="CONSIGNEE"&&x.airport){const c=String(x.airport).toUpperCase();if([...loaForm.elements.destinationAirport.options].some(o=>o.value===c))loaForm.elements.destinationAirport.value=c}
}

function renderPackageRows(){
  const count=Math.max(1,Math.min(30,Math.floor(Number(loaForm.elements.pieces.value)||1)));
  packageRows.innerHTML=Array.from({length:count},(_,i)=>`<div class="pkg-row"><label>Koli ${i+1} · kg<input class="pkg-weight" type="number" min="0" step=".01"></label><label>P cm<input class="pkg-length" type="number" min="0" step=".1"></label><label>L cm<input class="pkg-width" type="number" min="0" step=".1"></label><label>T cm<input class="pkg-height" type="number" min="0" step=".1"></label></div>`).join("");
}
loaForm.elements.pieces.addEventListener("input",renderPackageRows);
function packages(){return $$(".pkg-row").map((r,i)=>({piece:i+1,actualWeight:Number(r.querySelector(".pkg-weight").value)||0,length:Number(r.querySelector(".pkg-length").value)||0,width:Number(r.querySelector(".pkg-width").value)||0,height:Number(r.querySelector(".pkg-height").value)||0}))}
loaForm.addEventListener("submit",async e=>{
  e.preventDefault();loaResult.hidden=true;loaStatus.textContent="Mengambil harga SSOT dan membuat LoA…";$("#issue-loa").disabled=true;
  try{
    const b=Object.fromEntries(new FormData(loaForm));b.pieces=Number(b.pieces)||0;b.actualWeight=Number(b.actualWeight)||0;b.declaredValue=Number(b.declaredValue)||0;b.woodPacking=b.woodPacking==="YES";b.packages=packages();
    const d=await api("/.netlify/functions/indri-cgk-loa",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}),x=d.item;
    loaResult.hidden=false;loaResult.innerHTML=`<p class="eyebrow">LOA DIBUAT · MENUNGGU APPROVAL</p><h3>${esc(x.loaNumber)}</h3><p>${esc(x.customerName)} · ${esc(x.paymentScheme)} · CGK → ${esc(x.destinationAirport)}</p><p>Total penawaran <b>${money(x.total)}</b></p><div class="actions"><a class="button primary" href="${esc(x.pdfUrl)}" target="_blank" rel="noopener">Buka PDF LoA</a><button type="button" class="secondary" id="go-flow">Lanjut Approval</button></div>`;
    $("#go-flow").addEventListener("click",()=>showPanel("flow"));loaStatus.textContent="";await loadAll();
  }catch(err){loaStatus.textContent=err.message||String(err)}finally{$("#issue-loa").disabled=false}
});

function renderStock(){
  const rows=flow.stocks||[],box=$("#stock-list"),summary=$("#stock-summary"),s=flow.summary?.stock||{};
  summary.innerHTML=`<div><span>Shipment aktif</span><b>${Number(s.activeShipments)||0}</b></div><div><span>Koli</span><b>${Number(s.pieces)||0}</b></div><div><span>Berat</span><b>${(Number(s.weightKg)||0).toLocaleString("id-ID",{maximumFractionDigits:2})} kg</b></div><div><span>Masih di CGK</span><b>${Number(s.atCgk)||0}</b></div><div><span>Departed</span><b>${Number(s.departed)||0}</b></div><div><span>Arrived</span><b>${Number(s.arrived)||0}</b></div>`;
  if(!rows.length){box.innerHTML='<p class="preview">Belum ada Stock In Transit.</p>';return}
  box.innerHTML=rows.map(x=>`<article class="stock-card ${["RELEASED","CLOSED"].includes(String(x.status||"").toUpperCase())?"closed":""}">
    <div class="stock-head"><div><span class="stage">${esc(statusLabel(x.status))}</span><h3>${esc(x.stockId||"-")}</h3><p>${esc(x.customerName||"-")} · ${esc(x.originAirport||"CGK")} → ${esc(x.destinationAirport||"-")}</p></div><div class="stock-custody">${esc(x.custodyStatus||"-")}</div></div>
    <div class="stock-grid">
      <div><span>PTI</span><b>${esc(x.ptiNumber||"-")}</b></div>
      <div><span>Koli</span><b>${Number(x.pieces)||0}</b></div>
      <div><span>Berat</span><b>${(Number(x.currentWeightKg||x.receivedWeightKg)||0).toLocaleString("id-ID",{maximumFractionDigits:2})} kg</b></div>
      <div><span>Lokasi</span><b>${esc(x.currentLocation||"-")}</b></div>
      <div><span>SMU</span><b>${esc(x.smuNumber||"-")}</b></div>
      <div><span>Flight</span><b>${esc(x.flightNumber||"-")}</b></div>
    </div>
    <p class="meta">${esc(x.contents||"-")} · Update ${date(x.updatedAt||x.createdAt)}</p>
  </article>`).join("");
}
const nextAction={
  PENDING_APPROVAL:["APPROVE_LOA","Setujui LoA"],
  ISSUED:["APPROVE_LOA","Setujui LoA"],
  APPROVED:["RECEIVE_GOODS","Terima Barang / Stock In Transit"],
  RECEIVED:["PACK_COMPLETE","Selesai Packing"],
  PACKED:["AIRLINE_BOOK","Booking Airline"],
  AIRLINE_BOOKED:["ISSUE_SMU","Terbitkan SMU"],
  SMU_ISSUED:["MARK_DEPARTED","Tandai Departed"],
  DEPARTED:["MARK_ARRIVED","Tandai Arrived"],
  ARRIVED:["RELEASE_GOODS","Release Barang"]
};
function renderFlow(){
  const box=$("#flow-list"),rows=flow.loas||[];
  if(!rows.length){box.innerHTML='<p class="preview">Belum ada transaksi LoA.</p>';return}
  box.innerHTML=rows.map(x=>{
    const n=nextAction[x.status];
    return `<article class="flow-card"><div class="flow-main"><div><span class="stage">${esc(statusLabel(x.status))}</span><h3>${esc(x.loaNumber)}</h3><p><b>${esc(x.customerName||"-")}</b> · ${esc(x.paymentScheme||"-")} · CGK → ${esc(x.destinationAirport)}</p><p>${esc(x.contents||"-")} · ${Number(x.pieces)||0} koli · ${Number(x.estimatedChargeableWeight)||0} kg · <b>${money(x.total)}</b></p>${x.stock?`<p class="meta">Stock: <b>${esc(x.stock.stockId||"-")}</b> · ${esc(statusLabel(x.stock.status))} · ${esc(x.stock.currentLocation||"-")}</p>`:""}</div><div class="card-actions"><a class="button ghost" href="${esc(x.pdfUrl||"#")}" target="_blank" rel="noopener">LoA PDF</a>${n?`<button class="primary workflow-next" data-id="${esc(x.id)}" data-action="${n[0]}">${n[1]}</button>`:""}${!x.invoiceId&&["SMU_ISSUED","DEPARTED","ARRIVED","RELEASED"].includes(x.status)?`<button class="secondary workflow-next" data-id="${esc(x.id)}" data-action="ISSUE_INVOICE">Terbitkan Invoice</button>`:""}</div></div><div class="timeline">${timeline(x.status)}</div></article>`;
  }).join("");
  $$(".workflow-next").forEach(b=>b.addEventListener("click",()=>openWorkflow(b.dataset.action,b.dataset.id,"")));
}
function timeline(status){
  const steps=[["APPROVED","Approve"],["RECEIVED","Stock In"],["PACKED","Packing"],["AIRLINE_BOOKED","Booking"],["SMU_ISSUED","SMU"],["DEPARTED","Departed"],["ARRIVED","Arrived"],["RELEASED","Released"]];
  const rank={PENDING_APPROVAL:0,ISSUED:0,APPROVED:1,RECEIVED:2,PACKED:3,AIRLINE_BOOKED:4,SMU_ISSUED:5,DEPARTED:6,ARRIVED:7,RELEASED:8}[status]||0;
  return steps.map((s,i)=>`<span class="${rank>=i+1?"done":""}">${s[1]}</span>`).join("");
}
function field(label,name,type="text",value="",extra=""){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`}
function textarea(label,name,value=""){return `<label class="wide">${label}<textarea name="${name}">${esc(value)}</textarea></label>`}
function openWorkflow(action,loaId,invoiceId){
  workflowForm.reset();workflowStatus.textContent="";workflowForm.elements.action.value=action;workflowForm.elements.loaId.value=loaId||"";workflowForm.elements.invoiceId.value=invoiceId||"";
  const x=(flow.loas||[]).find(v=>v.id===loaId),inv=(flow.invoices||[]).find(v=>v.id===invoiceId);
  let title="",fields="";
  if(action==="APPROVE_LOA"){title="Approval LoA";fields=field("Disetujui oleh *","approvedBy","text","Customer","required")+field("Tanggal persetujuan","approvedAt","datetime-local")+field("Referensi approval","approvalRef","text","")+textarea("Catatan","notes")}
  if(action==="RECEIVE_GOODS"){title="Terima Barang → Stock In Transit";fields=field("Diterima oleh","receivedBy","text","Indri")+field("Waktu terima","receivedAt","datetime-local")+field("Jumlah koli","pieces","number",x?.pieces||1,'min="1" required')+field("Berat aktual (kg)","actualWeight","number",x?.actualWeight||"", 'min=".01" step=".01" required')+field("Kondisi barang","condition","text","Baik")+field("Lokasi gudang","warehouseLocation","text","Gudang CGK / Soetta")+field("Rak / area stok","rackLocation","text","")+textarea("Catatan penerimaan","notes")}
  if(action==="PACK_COMPLETE"){title="Packing Selesai";fields=field("Packing oleh","packedBy","text","Indri")+field("Waktu selesai","packedAt","datetime-local")+field("Jumlah koli akhir","pieces","number",x?.receipt?.pieces||x?.pieces||1,'min="1"')+field("Berat aktual akhir (kg)","actualWeight","number",x?.receipt?.actualWeight||x?.actualWeight||"", 'min=".01" step=".01"')+field("Berat volume (kg)","volumeWeight","number","",'min="0" step=".01"')+field("Jenis packing","packingType","text","STANDARD")+textarea("Catatan packing","notes")}
  if(action==="AIRLINE_BOOK"){title="Booking Airline";fields=field("Airline","airline","text",x?.airline||"", "required")+field("Kode booking *","bookingCode","text","", "required")+field("Flight number","flightNumber","text","")+field("Tanggal flight","flightDate","date","")+field("Berat booking (kg)","bookedWeight","number",x?.packing?.actualWeight||x?.estimatedChargeableWeight||"", 'min=".01" step=".01"')+textarea("Catatan booking","notes")}
  if(action==="ISSUE_SMU"){title="Terbitkan SMU";fields=field("Nomor SMU *","smuNumber","text","", "required")+field("Waktu terbit","issuedAt","datetime-local")+field("Flight number","flightNumber","text",x?.airlineBooking?.flightNumber||"")+field("Chargeable weight (kg)","chargeableWeight","number",x?.airlineBooking?.bookedWeight||x?.estimatedChargeableWeight||"", 'min=".01" step=".01"')+field("Biaya airline / HPP (Rp)","airlineCost","number","",'min="0" step="1000"')+textarea("Catatan SMU","notes")}
  if(action==="MARK_DEPARTED"){title="Tandai Shipment Departed";fields=field("Waktu berangkat","departedAt","datetime-local")+field("Flight number","flightNumber","text",x?.smu?.flightNumber||x?.airlineBooking?.flightNumber||"")+field("Airline","airline","text",x?.airlineBooking?.airline||x?.airline||"")+textarea("Catatan keberangkatan","notes")}
  if(action==="MARK_ARRIVED"){title="Tandai Shipment Arrived";fields=field("Waktu tiba","arrivedAt","datetime-local")+field("Diterima oleh / petugas tujuan","receivedBy","text","")+field("Referensi arrival","arrivalReference","text","")+textarea("Catatan arrival","notes")}
  if(action==="RELEASE_GOODS"){title="Release / Serah Terima Barang";fields=field("Waktu release","releasedAt","datetime-local")+field("Diserahkan kepada *","releasedTo","text","", "required")+field("No. identitas / referensi penerima","recipientIdRef","text","")+field("Referensi POD","podReference","text","")+field("Petugas release","releasedBy","text","")+textarea("Catatan release","notes")}
  if(action==="ISSUE_INVOICE"){title="Terbitkan Invoice";fields=field("Tanggal invoice","invoiceDate","date",new Date().toISOString().slice(0,10))+field("Jatuh tempo (opsional)","dueDate","date","")+field("Nilai invoice (Rp)","amount","number",x?.total||0,'min="1" step="1000" required')+textarea("Catatan invoice","notes")}
  if(action==="RECORD_PAYMENT"){title="Catat Pembayaran";fields=field("Nominal pembayaran (Rp)","amount","number",inv?.outstanding||0,'min="1" step="1000" required')+field("Tanggal / waktu bayar","paidAt","datetime-local")+field("Metode","method","text","TRANSFER")+field("Referensi transfer","reference","text","")+textarea("Catatan","notes")}
  $("#workflow-title").textContent=title;workflowFields.innerHTML=fields;workflowDialog.showModal();
}
workflowForm.addEventListener("submit",async e=>{
  e.preventDefault();if(e.submitter?.value==="cancel"){workflowDialog.close();return}
  const b=Object.fromEntries(new FormData(workflowForm));
  ["pieces","actualWeight","volumeWeight","bookedWeight","chargeableWeight","airlineCost","amount"].forEach(k=>{if(k in b)b[k]=Number(b[k])||0});
  workflowStatus.textContent="Menyimpan…";
  try{await api("/.netlify/functions/indri-cgk-workflow",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});workflowDialog.close();await loadAll()}
  catch(err){workflowStatus.textContent=err.message||String(err)}
});

function renderFinance(){
  const credit=$("#credit-summary"),cust=flow.customers||[];
  const interesting=cust.filter(x=>Number(x.finance?.outstanding||0)>0||x.paymentScheme==="CREDIT");
  credit.innerHTML=interesting.length?interesting.map(x=>`<article class="finance-card"><div><h3>${esc(x.legalName)}</h3><p>${esc(x.paymentScheme)} · PKS ${esc(x.pksNumber||"-")}</p></div><div class="finance-numbers"><span>Piutang<b>${money(x.finance?.outstanding||0)}</b></span>${x.paymentScheme==="CREDIT"?`<span>Plafond<b>${money(x.creditLimit)}</b></span><span>Sisa limit<b>${money(x.finance?.availableCredit||0)}</b></span>`:""}</div></article>`).join(""):'<p class="preview">Belum ada saldo piutang.</p>';
  const box=$("#invoice-list"),rows=flow.invoices||[];
  if(!rows.length){box.innerHTML='<p class="preview">Belum ada invoice.</p>';return}
  box.innerHTML=rows.map(x=>`<article class="master-card"><div><h3>${esc(x.invoiceNumber)}</h3><p><b>${esc(x.customerName)}</b> · ${esc(x.paymentScheme)} · LoA ${esc(x.loaNumber)}</p><p>Invoice ${money(x.amount)} · Terbayar ${money(x.paidTotal)} · <b>Sisa ${money(x.outstanding)}</b></p><p class="meta">Tanggal ${esc(x.invoiceDate)} · jatuh tempo ${esc(x.dueDate)} · ${esc(x.status)}</p></div><div class="card-actions">${x.outstanding>0?`<button class="primary pay-invoice" data-id="${esc(x.id)}">Catat Pembayaran</button>`:'<span class="paid-badge">LUNAS</span>'}</div></article>`).join("");
  $$(".pay-invoice").forEach(b=>b.addEventListener("click",()=>openWorkflow("RECORD_PAYMENT","",b.dataset.id)));
}
["#refresh-all","#refresh-stock","#refresh-flow","#refresh-finance"].forEach(s=>$(s).addEventListener("click",()=>loadAll().catch(e=>alert(e.message||String(e)))));
