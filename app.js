let STATIONS=[];let selectedImage=null;let originalW=0,originalH=0;
const $=id=>document.getElementById(id);
fetch('stations.json').then(r=>r.json()).then(d=>{STATIONS=d;$('manualHelp').textContent=`${d.length} stations chargées depuis Excel.`});

function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[|\[\]{}]/g,' ').replace(/[’']/g,' ').replace(/[.,;:]/g,' ').replace(/P\s*\.?\s*M\s*\.?/g,'PM').replace(/JEANNE\s*-?\s*MANCE/g,'JEANNE MANCE').replace(/ST\s*-?\s*ANTOINE/g,'ST ANTOINE').replace(/([A-Z])\s*\.\s*([A-Z])/g,'$1 $2').replace(/\s+/g,' ').trim()}
function normStation(s){return norm(s).replace(/[^A-Z0-9\-\/ ]+/g,' ').replace(/\s+/g,' ').trim()}
function display(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

// Important: N.15000 = niveau, S.2/S.6 = secteur. On ne les utilise jamais seuls pour confirmer.
function removeLevelSector(s){return normStation(s)
  .replace(/\bN\s*\.?\s*\d{1,5}\b/g,' ')
  .replace(/\bNIV\s*\.?\s*\d{1,5}\b/g,' ')
  .replace(/\bNIVEAU\s*\d{1,5}\b/g,' ')
  .replace(/\bS\s*\.?\s*\d{1,2}\b/g,' ')
  .replace(/\s+/g,' ').trim();
}
function extractPmLines(text){
  const lines=String(text||'').split(/\n+/).map(l=>l.trim()).filter(Boolean);
  const out=[];
  for(let line of lines){
    const n=normStation(line);
    const i=n.indexOf('PM');
    if(i>=0){out.push(removeLevelSector(n.slice(i)));continue;}
    // OCR peut lire APM/FAPM/B4PM, on garde depuis PM si présent après bruit.
    const m=n.match(/[A-Z0-9]{0,4}PM\s+.+/);
    if(m){out.push(removeLevelSector(m[0].slice(m[0].indexOf('PM'))));}
  }
  return out.filter(x=>x.length>=5);
}
function extractCodes(text){
  const all=normStation(text).replace(/[OQ]/g,'0').replace(/[IL]/g,'1');
  const codes=all.match(/\b\d{1,2}\s*[-]\s*\d{2,5}[A-Z]?\b/g)||[];
  return codes.map(c=>c.replace(/\s+/g,''));
}
function extractKeywords(text){
  const all=normStation(text);
  const keys=['JEANNE MANCE','VIGER','MELK','POSTE CANADA','ST ANTOINE','SAINT ANTOINE','VESTI','ESC','GARAGE','QUAI','HALL'];
  return keys.filter(k=>all.includes(k));
}
function buildQueries(text){
  const q=[...extractPmLines(text),...extractCodes(text),...extractKeywords(text)];
  const manual=removeLevelSector(text);
  if(manual.length>2 && manual.length<60) q.push(manual);
  return [...new Set(q.map(x=>x.trim()).filter(x=>x.length>=3 && !/^S\s*\d+$/.test(x) && !/^N\s*\d+$/.test(x) && !/^\d{4,5}$/.test(x)))];
}
function tokenList(s){return removeLevelSector(s).split(/\s+/).filter(t=>t.length>=3 && !['PM','HALL','PRES','PRET','PORTE','LOCAL','CORR','NIV','NIVEAU'].includes(t));}
function scoreStation(query,st){
  const q=removeLevelSector(query); if(!q || q.length<3)return 0;
  const station=removeLevelSector(st.station);
  const hay=removeLevelSector([st.station,st.identification,st.description,st.localisation,st.niveau,st.etage].join(' '));
  let score=0;
  const qNoSpace=q.replace(/\s/g,''); const hayNoSpace=hay.replace(/\s/g,'');
  const code=q.match(/\b\d{1,2}-\d{2,5}[A-Z]?\b/);
  if(code && hayNoSpace.includes(code[0].replace(/\s/g,''))) score+=220;
  if(q.includes(station) && station.length>5) score+=180;
  if(station.includes(q) && q.length>5) score+=170;
  if(hay.includes(q) && q.length>5) score+=130;
  const qt=tokenList(q); const stt=tokenList(station);
  for(const t of qt){
    if(stt.includes(t)) score+=55;
    else if(hay.includes(t)) score+=25;
    else if(t.length>=5 && hayNoSpace.includes(t.replace(/\s/g,''))) score+=20;
  }
  // Combinaisons fortes
  if(q.includes('JEANNE') && q.includes('MANCE') && hay.includes('JEANNE') && hay.includes('MANCE')) score+=180;
  if(q.includes('VIGER') && hay.includes('VIGER')) score+=120;
  if(q.includes('MELK') && hay.includes('MELK')) score+=120;
  if(q.includes('POSTE') && q.includes('CANADA') && hay.includes('POSTE') && hay.includes('CANADA')) score+=180;
  return score;
}
function searchSmart(raw){
  const queries=buildQueries(raw); let scored=[];
  for(const st of STATIONS){let best=0,bq=''; for(const q of queries){const s=scoreStation(q,st); if(s>best){best=s;bq=q}} if(best>0) scored.push({...st,score:best,matched:bq});}
  scored.sort((a,b)=>b.score-a.score);
  return {queries,scored};
}
function renderResult(raw){
  const {queries,scored}=searchSmart(raw); $('query').textContent='Ligne détectée / recherchée : '+(queries[0]||'—');
  const box=$('result'); box.innerHTML='';
  const top=scored[0], second=scored[1];
  if(top && top.score>=180 && (!second || top.score-second.score>=50 || top.score>=300)){box.innerHTML=stationCard(top);return;}
  box.innerHTML=`<div class="warn">Résultat non confirmé. Je n'affiche pas automatiquement une station si le texte OCR est trop faible. Ajuste la bande bleue sur la ligne PM, ou choisis une possibilité.</div>`+
    scored.slice(0,10).map(st=>`<div class="item" data-n="${display(st.numero)}"><b>${display(st.station)}</b> — ${display(st.description)}<br><small>Score ${st.score} • trouvé par : ${display(st.matched)}</small></div>`).join('');
  box.querySelectorAll('.item').forEach(el=>el.onclick=()=>{const st=scored.find(s=>String(s.numero)===el.dataset.n); if(st) box.innerHTML=stationCard(st)});
}
function stationCard(st){return `<div class="ok"><h2>✅ Station trouvée</h2><div class="bigdesc">${display(st.description)}</div><div class="meta"><div class="label">N°</div><div>${display(st.numero)}</div><div class="label">Station</div><div>${display(st.station)}</div><div class="label">Identification</div><div>${display(st.identification||'Non identifié')}</div><div class="label">Étage</div><div>${display(st.etage)}</div><div class="label">Niveau</div><div>${display(st.niveau)}</div><div class="label">Secteur</div><div>${display(st.localisation)}</div></div></div>`}

$('photo').addEventListener('change',e=>{const f=e.target.files[0]; if(!f)return; selectedImage=new Image(); selectedImage.onload=()=>{originalW=selectedImage.width;originalH=selectedImage.height;drawAll();}; selectedImage.src=URL.createObjectURL(f);});
$('cropY').oninput=drawAll; $('cropH').oninput=drawAll;
function drawAll(){if(!selectedImage)return; drawFull(); drawCrop(); $('status').textContent='Photo chargée. Ajuste la bande bleue si nécessaire, puis lance OCR.'}
function drawFull(){
  const c=$('fullCanvas'), img=selectedImage, targetW=320, scale=targetW/img.width; c.width=targetW; c.height=Math.round(img.height*scale); const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,c.width,c.height);
  const y=Number($('cropY').value)/100*c.height, h=Number($('cropH').value)/100*c.height; const ov=$('cropOverlay'); ov.style.top=y+'px'; ov.style.height=h+'px';
}
function drawCrop(){
  const c=$('cropCanvas'), img=selectedImage; const yPct=Number($('cropY').value)/100, hPct=Number($('cropH').value)/100;
  const sx=img.width*0.02, sw=img.width*0.96, sy=img.height*yPct, sh=img.height*hPct;
  const targetW=900, scale=targetW/sw; c.width=targetW; c.height=Math.round(sh*scale); const ctx=c.getContext('2d'); ctx.imageSmoothingEnabled=false; ctx.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
  // contraste simple pour texte blanc sur fond mauve/rouge
  const im=ctx.getImageData(0,0,c.width,c.height); const d=im.data;
  for(let i=0;i<d.length;i+=4){let g=(d[i]+d[i+1]+d[i+2])/3; g=g>150?255:0; d[i]=d[i+1]=d[i+2]=g;}
  ctx.putImageData(im,0,0);
}
async function runOCR(){
  if(!selectedImage){alert('Ajoute une photo.');return}
  drawCrop(); $('status').textContent='OCR en cours...';
  const res=await Tesseract.recognize($('cropCanvas'),'fra+eng',{logger:m=>{if(m.status)$('status').textContent=`OCR : ${m.status} ${m.progress?Math.round(m.progress*100)+'%':''}`}, tessedit_pageseg_mode:'7'});
  let text=res.data.text||'';
  // Si la bande choisie ne donne rien, on teste deux bandes proches autour de la position choisie.
  if(!buildQueries(text).length){
    const baseY=Number($('cropY').value); const oldY=$('cropY').value; const tries=[baseY-5,baseY+5,baseY+10].filter(v=>v>=15&&v<=75);
    for(const y of tries){$('cropY').value=y; drawCrop(); const r=await Tesseract.recognize($('cropCanvas'),'fra+eng',{tessedit_pageseg_mode:'7'}); text+='\n'+(r.data.text||''); if(buildQueries(text).length) break;}
    $('cropY').value=oldY; drawAll();
  }
  $('ocrText').textContent=text; $('status').textContent='OCR terminé. Recherche terminée.'; renderResult(text);
}
$('ocrBtn').onclick=runOCR; $('manualBtn').onclick=()=>renderResult($('manual').value); $('manual').addEventListener('keydown',e=>{if(e.key==='Enter')renderResult($('manual').value)}); $('resetBtn').onclick=()=>location.reload();
