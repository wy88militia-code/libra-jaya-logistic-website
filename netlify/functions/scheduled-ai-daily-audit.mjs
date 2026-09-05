import { generateControlTowerReport } from './_ai-control-tower-core.mjs';
import { markSystemHeartbeat } from './_system-heartbeat-core.mjs';

export default async ()=>{try{const report=await generateControlTowerReport({periodHours:24,kind:'DAILY',source:'SCHEDULED_DAILY_07_WIT'});console.log(JSON.stringify({event:'LIBRA_AI_AUDIT_RESUME',kind:'DAILY',reportId:report.reportId,risk:report.risk,score:report.score,aiUsed:report.aiUsed}));}catch(error){await markSystemHeartbeat('AI_CONTROL_TOWER',{status:'ERROR',message:`Daily audit gagal: ${String(error?.message||error).slice(0,430)}`}).catch(()=>{});throw error;}};
// Netlify cron UTC: 22:00 UTC = 07:00 WIT (UTC+9) hari berikutnya.
export const config={schedule:'0 22 * * *'};
