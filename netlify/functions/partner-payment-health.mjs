export default async request=>{
  if(request.method!=="GET")return Response.json({message:"Metode tidak diizinkan."},{status:405});
  const secret=String(process.env.XENDIT_SECRET_KEY||"").trim();
  const webhook=String(process.env.XENDIT_WEBHOOK_TOKEN||"").trim();
  const qrisMax=Math.max(1,Math.trunc(Number(process.env.PARTNER_QRIS_MAX_AMOUNT||10000000)));
  return Response.json({
    service:"Libra Partner Deposit",
    xenditSecretConfigured:Boolean(secret),
    webhookTokenConfigured:Boolean(webhook),
    qrisMaxAmount:qrisMax,
    readyForApiCalls:Boolean(secret),
    readyForAutomaticWalletCredit:Boolean(secret&&webhook),
    webhookPath:"/.netlify/functions/xendit-partner-webhook",
    modeHint:secret.startsWith("xnd_development_")?"TEST":secret.startsWith("xnd_production_")?"LIVE":"UNKNOWN_OR_NOT_SET",
    checkedAt:new Date().toISOString()
  },{headers:{"cache-control":"no-store"}});
};

export const config={path:"/.netlify/functions/partner-payment-health",method:"GET"};
