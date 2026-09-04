import { runSystemHealth } from './_system-health-core.mjs';

export default async ()=>{
  const health=await runSystemHealth({emitNotifications:true,source:'SCHEDULED_10_MIN'});
  console.log(JSON.stringify({event:'LIBRA_SYSTEM_HEALTH',overall:health.overall,summary:health.summary,issueFingerprint:health.issueFingerprint,checkedAt:health.checkedAt}));
};

export const config={schedule:'*/10 * * * *'};
