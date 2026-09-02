const form=document.querySelector('#admin-login-form');
const username=document.querySelector('#admin-user');
const pin=document.querySelector('#admin-pin');
const otp=document.querySelector('#admin-otp');
const status=document.querySelector('#login-status');
const button=form?.querySelector('button');

form?.addEventListener('submit',async event=>{
  event.preventDefault();status.textContent='';button.disabled=true;button.textContent='Memverifikasi…';
  try{
    const response=await fetch('/.netlify/functions/admin-auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:username.value,pin:pin.value,otp:otp.value})});
    const result=await response.json();if(!response.ok)throw new Error(result.message||'Akun admin tidak dapat diverifikasi.');window.location.assign(result.redirect||'/admin-tool');
  }catch(error){status.textContent=error.message;pin.value='';otp.value='';pin.focus();}
  finally{button.disabled=false;button.textContent='Masuk Admin Tool';}
});
