export default request=>new Response(null,{status:302,headers:{location:new URL('/',request.url).toString(),'set-cookie':'libra_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict','cache-control':'no-store'}});
export const config={path:'/.netlify/functions/admin-logout'};
