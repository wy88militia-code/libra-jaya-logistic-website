import crypto from 'node:crypto';

const DEFAULT_SHEET_ID='1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k';
const n=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const txt=v=>String(v??'').trim();
function b64(v){return Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');}
function key(){return String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY||'').replace(/\\n/g,'\n').trim();}
async function token(){
 const email=String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL||'').trim(),privateKey=key();if(!email||!privateKey)throw new Error('Google Service Account belum dikonfigurasi.');
 const now=Math.floor(Date.now()/1000),h=b64({alg:'RS256',typ:'JWT'}),p=b64({iss:email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}),u=`${h}.${p}`,s=crypto.createSign('RSA-SHA256');s.update(u);s.end();const assertion=`${u}.${s.sign(privateKey).toString('base64url')}`;
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})}),j=await r.json();if(!r.ok||!j.access_token)throw new Error(j.error_description||j.error||'Gagal token Google.');return j.access_token;
}
function componentMap(rows=[]){const map=new Map();for(const row of rows.slice(1)){const code=txt(row?.[0]);if(!code)continue;map.set(code,row?.[2]);}return map;}
function zoneMap(rows=[]){const map=new Map();for(const row of rows.slice(1)){const zone=txt(row?.[7]);if(!zone||zone==='ZONA / GRUP MODAL'||zone==='AYAPO'||zone==='TAGIHAN SISTEM')continue;const target=n(row?.[12],NaN),floor=n(row?.[13],NaN);if(!Number.isFinite(target)||!Number.isFinite(floor))continue;map.set(zone,{zone,minimumLoadKg:n(row?.[8]),tripsPerDay:n(row?.[9]),miscPerTrip:n(row?.[10]),fuelEfficiencyLoaded:n(row?.[11]),targetGrossMargin:target,floorGrossMargin:floor,note:txt(row?.[14])});}return map;}
export async function getLiveFinanceRouteCosts(){
 const sheetId=process.env.MASTER_SHEET_ID||DEFAULT_SHEET_ID,t=await token(),q=new URLSearchParams({majorDimension:'ROWS',valueRenderOption:'UNFORMATTED_VALUE'});q.append('ranges',"'Modal Rute Pilot'!A24:AO200");q.append('ranges',"'Komponen Biaya'!A4:O80");
 const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${q}`,{headers:{authorization:`Bearer ${t}`}}),j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Gagal membaca cost model Finance.');
 const [routeRange,componentRange]=j.valueRanges||[],rows=routeRange?.values||[],componentRows=componentRange?.values||[],components=componentMap(componentRows),marginZones=zoneMap(componentRows),routes=new Map();
 for(const row of rows.slice(1)){const code=txt(row[0]);if(!code)continue;routes.set(code,{kodeRute:code,tujuan:txt(row[3]),grupModal:txt(row[4]),minimumLoadKg:n(row[10]),bbmTrip:n(row[11]),maintenanceTrip:n(row[12]),sdmTrip:n(row[13]),miscTrip:n(row[14]),contingencyTrip:n(row[15]),fullCostTrip:n(row[16]),costPerKgMinLoad:n(row[18]),targetRevenueMinLoad:n(row[19]),targetRatePerKg:n(row[20]),floorRatePerKg:n(row[21]),recommendedRatePerKg:n(row[22]),grossMarginMinLoad:n(row[23]),tripsPerHari:n(row[24]),depresiasiTrip:n(row[30]),pajakAsuransiTrip:n(row[31]),cashOpexTrip:n(row[32]),modelHandlingTrip:n(row[33]),elevationGainOneWayM:n(row[34]),elevationLossOneWayM:n(row[35]),totalClimbRoundTripM:n(row[36]),fuelElevationExtraL:n(row[37]),terrainMaintenanceFactor:n(row[38],1),elevationStatus:txt(row[39]),effectiveFuelKmL:n(row[40])});}
 const get=k=>n(components.get(k));
 const usdIdrBudgetRate=get('USD_IDR_BUDGET_RATE')||16500;
 const systemCosts={
  usdIdrBudgetRate,
  netlifyUsd:get('SYS_NETLIFY_CYCLE_USD'),
  openAiUsd:get('SYS_OPENAI_CYCLE_USD'),
  googleWorkspaceUsd:get('SYS_GOOGLE_WORKSPACE_CYCLE_USD'),
  googleCloudMapsUsd:get('SYS_GOOGLE_CLOUD_CYCLE_USD'),
  githubUsd:get('SYS_GITHUB_CYCLE_USD'),
  whatsappMetaUsd:get('SYS_WHATSAPP_CYCLE_USD'),
  hostingDomainOtherIdr:get('SYS_HOSTING_DOMAIN_MONTH_IDR'),
  monthlyIdr:get('SYSTEM_SOFTWARE_COST_MONTH_IDR'),
  dailyIdr:get('SYSTEM_SOFTWARE_COST_DAY'),
 };
 return {routes,components,marginZones,contingencyPct:get('CONTINGENCY_PCT')||0.1,workingCapitalBufferPct:get('WORKING_CAPITAL_BUFFER_PCT')||0.2,vehicleCapacityKg:get('VEHICLE_CAPACITY_KG')||805,handlingIncomingPerSmu:get('HANDLING_INCOMING_PER_SMU')||25000,defaultTargetMargin:get('DEFAULT_TARGET_GM')||0.35,defaultFloorMargin:get('DEFAULT_FLOOR_GM')||0.25,sdmPerDay:get('SDM_COST_DAY'),totalSdmMonthly:get('TOTAL_SDM_MONTH'),totalSalaryMonthly:get('TOTAL_SALARY_MONTH'),driverAllowanceDaily:get('DRIVER_ALLOWANCE_DAY'),systemCosts,staffBreakdown:{driverMonthly:get('DRIVER_SALARY_MONTH'),adminMonthly:get('ADMIN_SALARY_MONTH'),accountingMonthly:get('ACCOUNTING_SALARY_MONTH'),mealDaily:get('DRIVER_MEAL_DAY'),snackDaily:get('DRIVER_SNACK_DAY'),cigaretteDaily:get('DRIVER_CIGARETTE_DAY')}};
}
