export default request=>new Response(null,{status:302,headers:{location:new URL('/courier-login.html',request.url).toString(),'set-cookie':'libra_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict','cache-control':'no-store'}});
export const config={path:'/.netlify/functions/courier-logout'};
