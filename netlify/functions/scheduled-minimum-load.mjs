import { runMinimumLoadConsolidation } from './_consolidation-core.mjs';

export default async ()=>{
  const result=await runMinimumLoadConsolidation();
  console.log(JSON.stringify({event:'LIBRA_MINIMUM_LOAD_CONSOLIDATION',...result}));
};

export const config={schedule:'*/15 * * * *'};
