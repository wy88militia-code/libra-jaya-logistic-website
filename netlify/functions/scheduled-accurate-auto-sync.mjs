import { runAccurateAutoSync } from './_accurate-auto-core.mjs';

export default async ()=>{
  const result=await runAccurateAutoSync({limit:60});
  console.log(JSON.stringify({event:'LIBRA_ACCURATE_AUTO_SYNC',...result}));
};

export const config={schedule:'*/5 * * * *'};
