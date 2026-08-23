const form=document.querySelector('#admin-login-form');
const input=document.querySelector('#admin-pin');
const status=document.querySelector('#login-status');
const button=form?.querySelector('button');

form?.addEventListener('submit',async event=>{
  event.preventDefault();
  status.textContent='';
  button.disabled=true;
  button.textContent='Memverifikasi…';
  try{
    const response=await fetch('/.netlify/functions/admin-auth',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({pin:input.value})
    });
    const result=await response.json();
    if(!response.ok)throw new Error(result.message||'PIN tidak dapat diverifikasi.');
    window.location.assign(result.redirect||'/admin-tool');
  }catch(error){
    status.textContent=error.message;
    input.value='';
    input.focus();
  }finally{
    button.disabled=false;
    button.textContent='Masuk Admin Tool';
  }
});
