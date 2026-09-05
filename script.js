const toggle=document.querySelector('.menu-toggle');const nav=document.querySelector('.site-header nav');toggle?.addEventListener('click',()=>{const open=nav.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'×':'☰'});nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');toggle.setAttribute('aria-expanded','false');toggle.textContent='☰'}));

const partnerJoinHead=document.querySelector('.partner-join-head');
if(partnerJoinHead&&!partnerJoinHead.querySelector('.partner-rate-cta')){
  const rateLink=document.createElement('a');
  rateLink.className='join-cta manual partner-rate-cta';
  rateLink.href='/harga-partner';
  rateLink.innerHTML='Lihat Daftar Harga Partner Terbaru <b>↗</b>';
  rateLink.style.display='inline-flex';
  rateLink.style.marginTop='14px';
  partnerJoinHead.appendChild(rateLink);
}
