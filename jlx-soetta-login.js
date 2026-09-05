const form=document.querySelector('#jlx-login-form');
const username=document.querySelector('#jlx-user');
const pin=document.querySelector('#jlx-pin');
const otp=document.querySelector('#jlx-otp');
const status=document.querySelector('#jlx-status');
const button=form?.querySelector('button');

form?.addEventListener('submit',async event=>{
  event.preventDefault();status.textContent='';button.disabled=true;button.textContent='Memverifikasi…';
  try{
    const response=await fetch('/.netlify/functions/admin-auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({portal:'jlx-soetta',username:username.value,pin:pin.value,otp:otp.value})});
    const result=await response.json();if(!response.ok)throw new Error(result.message||'Akun tidak dapat diverifikasi.');window.location.assign(result.redirect||'/jlx-soetta');
  }catch(error){status.textContent=error.message;pin.value='';otp.value='';pin.focus();}
  finally{button.disabled=false;button.textContent='Masuk JL Express Soetta';}
});
