import { retryDueWebhookDeliveries } from './_partner-webhook.mjs';

export default async ()=>{
  const results=await retryDueWebhookDeliveries(10);
  console.log('Libra webhook retry batch',results.map(row=>({deliveryId:row.deliveryId,status:row.status,attempts:row.attempts,lastHttpStatus:row.lastHttpStatus,lastError:row.lastError})));
};
export const config={schedule:'* * * * *'};
