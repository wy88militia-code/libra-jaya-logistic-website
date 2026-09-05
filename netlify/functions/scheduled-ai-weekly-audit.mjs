import { generateControlTowerReport } from './_ai-control-tower-core.mjs';
import { markSystemHeartbeat } from './_system-heartbeat-core.mjs';

export default async ()=>{try{const report=await generateControlTowerReport({periodHours:168,kind:'WEEKLY',source:'SCHEDULED_MONDAY_08_WIT'});console.log(JSON.stringify({event:'LIBRA_AI_AUDIT_RESUME',kind:'WEEKLY',reportId:report.reportId,risk:report.risk,score:report.score,aiUsed:report.aiUsed}));}catch(error){await markSystemHeartbeat('AI_CONTROL_TOWER',{status:'ERROR',message:`Weekly audit gagal: ${String(error?.message||error).slice(0,430)}`}).catch(()=>{});throw error;}};
// Netlify cron UTC: Minggu 23:00 UTC = Senin 08:00 WIT (UTC+9).
export const config={schedule:'0 23 * * 0'};
