import { generateControlTowerReport } from './_ai-control-tower-core.mjs';
import { markSystemHeartbeat } from './_system-heartbeat-core.mjs';

export default async ()=>{try{const report=await generateControlTowerReport({periodHours:1,kind:'HOURLY',source:'SCHEDULED_HOURLY'});console.log(JSON.stringify({event:'LIBRA_AI_CONTROL_TOWER',kind:'HOURLY',reportId:report.reportId,risk:report.risk,score:report.score,aiUsed:report.aiUsed}));}catch(error){await markSystemHeartbeat('AI_CONTROL_TOWER',{status:'ERROR',message:String(error?.message||error).slice(0,500)}).catch(()=>{});console.error(JSON.stringify({event:'LIBRA_AI_CONTROL_TOWER_ERROR',kind:'HOURLY',error:String(error?.message||error).slice(0,500)}));throw error;}};
export const config={schedule:'0 * * * *'};
