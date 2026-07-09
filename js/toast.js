// ---------- toast ----------
var toEl=document.getElementById('toast'), toT;
export function toast(m){ toEl.textContent=m; toEl.classList.add('show'); clearTimeout(toT); toT=setTimeout(function(){toEl.classList.remove('show');},1900); }
