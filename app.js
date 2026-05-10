let STATIONS = [];
let selectedImage = null;
const $ = id => document.getElementById(id);

fetch('stations.json')
  .then(r => r.json())
  .then(d => {
    STATIONS = d;
    $('manualHelp').textContent = `${d.length} stations chargées depuis Excel.`;
  });

function display(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[|\[\]{}]/g, ' ')
    .replace(/[’']/g, ' ')
    .replace(/\bP\s*\.?\s*M\s*\.?\b/g, 'PM')
    .replace(/JEANNE\s*-?\s*MANCE/g, 'JEANNE MANCE')
    .replace(/ST\s*-?\s*ANTOINE/g, 'ST ANTOINE')
    .replace(/SAINT\s*-?\s*ANTOINE/g, 'ST ANTOINE')
    .replace(/[,:;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeOcrChars(s) {
  // Corrections fréquentes OCR sur les panneaux: O/Q -> 0, I/l -> 1 dans les zones numériques.
  return norm(s)
    .replace(/(?<=\d)[OQ](?=\d)/g, '0')
    .replace(/(?<=\d)[IL](?=\d)/g, '1')
    .replace(/(?<=\d)S(?=\d)/g, '5');
}

function removeLevelSector(s) {
  // N = niveau, S = secteur. Ça aide à filtrer, mais ça ne confirme jamais seul une station.
  return norm(s)
    .replace(/\bN\s*\.?\s*\d{1,5}\b/g, ' ')
    .replace(/\bNIV\s*\.?\s*\d{1,5}\b/g, ' ')
    .replace(/\bNIVEAU\s*\d{1,5}\b/g, ' ')
    .replace(/\bS\s*\.?\s*\d{1,2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLevel(text) {
  const t = normalizeOcrChars(text);
  const m = t.match(/\bN\s*\.?\s*(\d{4,5})\b/);
  return m ? m[1] : '';
}

function extractSectorNumber(text) {
  const t = normalizeOcrChars(text);
  const m = t.match(/\bS\s*\.?\s*(\d{1,2})\b/);
  return m ? m[1] : '';
}

function extractPmSegments(text) {
  const raw = normalizeOcrChars(text).replace(/\n/g, ' | ');
  const segments = [];
  // Cherche PM même si OCR ajoute des lettres avant: APM, FAPM, B4PM.
  const re = /(?:[A-Z0-9]{0,4})PM\s+[^|\n]{3,90}/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const seg = m[0].slice(m[0].indexOf('PM'));
    segments.push(removeLevelSector(seg));
  }
  // Si Tesseract a collé tout ensemble: PMHALL...
  const re2 = /PM[A-Z0-9\- ]{4,90}/g;
  while ((m = re2.exec(raw.replace(/[^A-Z0-9\-\. ]/g, ' '))) !== null) {
    let seg = m[0].replace(/^PM/, 'PM ');
    segments.push(removeLevelSector(seg));
  }
  return [...new Set(segments.map(x => x.trim()).filter(x => x.length >= 5))];
}

function extractCodes(text) {
  const t = normalizeOcrChars(text);
  const codes = new Set();
  // 15-602, 15 602, 15.602
  for (const m of t.matchAll(/\b(\d{1,2})\s*[-\. ]\s*(\d{2,5})([A-Z])?\b/g)) {
    const left = m[1], right = m[2];
    // évite N 15000 et S 2
    if (right.length >= 2 && !(left === 'N') && !(left === 'S')) codes.add(`${left}-${right}${m[3] || ''}`);
  }
  // Cas collé: 15602 => 15-602, 22300 => 22-300
  for (const m of t.matchAll(/\b(\d{5,6})\b/g)) {
    const n = m[1];
    if (n === extractLevel(text)) continue;
    if (n.length === 5) codes.add(`${n.slice(0, 2)}-${n.slice(2)}`);
    if (n.length === 6) codes.add(`${n.slice(0, 2)}-${n.slice(2)}`);
  }
  return [...codes];
}

function extractKeywords(text) {
  const t = normalizeOcrChars(text);
  const keys = ['JEANNE MANCE', 'VIGER', 'MELK', 'POSTE CANADA', 'ST ANTOINE', 'VESTI', 'ESC', 'GARAGE', 'QUAI', 'HALL', 'PRES', 'PRESSE', 'CAFE'];
  return keys.filter(k => t.includes(k));
}

function buildQueries(text, mode = 'ocr') {
  const q = [];
  q.push(...extractPmSegments(text));
  q.push(...extractCodes(text));
  q.push(...extractKeywords(text));
  const cleaned = removeLevelSector(text);
  if (mode === 'manual' && cleaned.length >= 3) q.push(cleaned);
  return [...new Set(q.map(x => x.trim()).filter(x => x.length >= 3 && !/^S\s*\d+$/i.test(x) && !/^N\s*\d+$/i.test(x) && !/^\d{4,5}$/.test(x)))];
}

const STOP = new Set(['PM', 'P', 'M', 'HALL', 'PRES', 'PRESSE', 'PORTE', 'LOCAL', 'CORR', 'NIV', 'NIVEAU', 'SORTIE', 'ENTREE', 'ACCES', 'ACC', 'SUD', 'NORD', 'EST', 'OUEST']);
function tokenList(s) {
  return removeLevelSector(s)
    .replace(/[^A-Z0-9\- ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP.has(t));
}
function compact(s) { return norm(s).replace(/[^A-Z0-9]/g, ''); }

function scoreStation(query, st, mode = 'ocr', rawText = '') {
  const q = removeLevelSector(query);
  if (!q || q.length < 3) return 0;

  const station = removeLevelSector(st.station);
  const stationHay = removeLevelSector([st.station, st.identification, st.niveau, st.etage, st.localisation].join(' '));
  const manualHay = removeLevelSector([st.station, st.identification, st.description, st.localisation, st.niveau, st.etage].join(' '));
  const hay = mode === 'manual' ? manualHay : stationHay; // IMPORTANT: OCR ne cherche plus dans la description pour éviter les faux positifs.
  const qC = compact(q), hayC = compact(hay), stationC = compact(station);

  let score = 0;

  // Code porte/local: 15-602, 15-320, etc. = meilleur indice.
  const codeMatches = extractCodes(q);
  for (const code of codeMatches) {
    const c = compact(code);
    if (stationC.includes(c)) score += 400;
    else if (hayC.includes(c)) score += 250;
  }

  // Ligne PM complète ou partielle.
  if (q.length >= 6) {
    if (station.includes(q) || q.includes(station)) score += 220;
    if (stationC.includes(qC) || qC.includes(stationC)) score += 180;
    if (hay.includes(q)) score += 100;
  }

  // Tokens significatifs, seulement dans Station/ID pour OCR.
  const qt = tokenList(q);
  const stt = tokenList(station).join(' ');
  for (const t of qt) {
    if (stt.includes(t)) score += 80;
    else if (hay.includes(t)) score += 35;
  }

  // Combinaisons importantes.
  if (q.includes('JEANNE') && q.includes('MANCE') && station.includes('JEANNE') && station.includes('MANCE')) score += 350;
  if (q.includes('VIGER') && station.includes('VIGER')) score += 220;
  if (q.includes('MELK') && station.includes('MELK')) score += 220;
  if (q.includes('POSTE') && q.includes('CANADA') && station.includes('POSTE') && station.includes('CANADA')) score += 300;

  // Niveau: utile seulement comme bonus, jamais suffisant seul.
  const level = extractLevel(rawText);
  if (level && String(st.niveau || '').replace(/\D/g, '') === level) score += 35;

  // Pénalité si la requête OCR ne contient ni PM, ni code, ni mot fort.
  const hasStrong = /\bPM\b/.test(q) || codeMatches.length > 0 || ['JEANNE', 'VIGER', 'MELK', 'POSTE', 'CANADA'].some(k => q.includes(k));
  if (mode === 'ocr' && !hasStrong) score = Math.min(score, 40);

  return score;
}

function searchSmart(raw, mode = 'ocr') {
  const queries = buildQueries(raw, mode);
  const scored = [];
  for (const st of STATIONS) {
    let best = 0, bq = '';
    for (const q of queries) {
      const s = scoreStation(q, st, mode, raw);
      if (s > best) { best = s; bq = q; }
    }
    if (best > 0) scored.push({ ...st, score: best, matched: bq });
  }
  scored.sort((a, b) => b.score - a.score);
  return { queries, scored };
}

function renderResult(raw, mode = 'ocr') {
  const { queries, scored } = searchSmart(raw, mode);
  const level = extractLevel(raw), sector = extractSectorNumber(raw);
  $('query').textContent = 'Ligne détectée / recherchée : ' + (queries[0] || '—') + (level ? `   | Niveau lu : ${level}` : '') + (sector ? `   | Secteur lu : S.${sector}` : '');

  const box = $('result');
  box.innerHTML = '';
  const top = scored[0], second = scored[1];

  // Confirmation stricte: le top doit être nettement meilleur.
  if (top && top.score >= 300 && (!second || top.score - second.score >= 120)) {
    box.innerHTML = stationCard(top);
    return;
  }

  box.innerHTML = `<div class="warn">Résultat non confirmé. Je préfère ne pas afficher automatiquement une mauvaise station. Clique sur la bonne suggestion ou tape un élément visible.</div>` +
    scored.slice(0, 10).map(st => `<div class="item" data-n="${display(st.numero)}"><b>${display(st.station)}</b> — ${display(st.description)}<br><small>Score ${st.score} • trouvé par : ${display(st.matched)}</small></div>`).join('');
  box.querySelectorAll('.item').forEach(el => el.onclick = () => {
    const st = scored.find(s => String(s.numero) === el.dataset.n);
    if (st) box.innerHTML = stationCard(st);
  });
}

function stationCard(st) {
  return `<div class="ok"><h2>✅ Station trouvée</h2><div class="bigdesc">${display(st.description)}</div><div class="meta"><div class="label">N°</div><div>${display(st.numero)}</div><div class="label">Station</div><div>${display(st.station)}</div><div class="label">Identification</div><div>${display(st.identification || 'Non identifié')}</div><div class="label">Étage</div><div>${display(st.etage)}</div><div class="label">Niveau</div><div>${display(st.niveau)}</div><div class="label">Secteur</div><div>${display(st.localisation)}</div></div></div>`;
}

$('photo').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  selectedImage = new Image();
  selectedImage.onload = () => drawAll();
  selectedImage.src = URL.createObjectURL(f);
});
$('cropY').oninput = drawAll;
$('cropH').oninput = drawAll;

function drawAll() {
  if (!selectedImage) return;
  drawFull();
  drawCrop();
  $('status').textContent = 'Photo chargée. Ajuste la bande bleue sur la ligne PM, puis lance OCR.';
}
function drawFull() {
  const c = $('fullCanvas'), img = selectedImage, targetW = 320, scale = targetW / img.width;
  c.width = targetW; c.height = Math.round(img.height * scale);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const y = Number($('cropY').value) / 100 * c.height;
  const h = Number($('cropH').value) / 100 * c.height;
  const ov = $('cropOverlay');
  ov.style.top = y + 'px'; ov.style.height = h + 'px';
}
function drawCrop(preprocess = 'normal') {
  const c = $('cropCanvas'), img = selectedImage;
  const yPct = Number($('cropY').value) / 100, hPct = Number($('cropH').value) / 100;
  const sx = img.width * 0.02, sw = img.width * 0.96, sy = img.height * yPct, sh = img.height * hPct;
  const targetW = 1200, scale = targetW / sw;
  c.width = targetW; c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);

  const im = ctx.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    let gray = (r * 0.299 + g * 0.587 + b * 0.114);
    if (preprocess === 'bw') {
      gray = gray > 120 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = gray;
    } else if (preprocess === 'invert') {
      gray = gray > 120 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = gray;
    } else {
      // gris contrasté mais pas trop agressif
      gray = Math.max(0, Math.min(255, (gray - 80) * 1.7));
      d[i] = d[i + 1] = d[i + 2] = gray;
    }
  }
  ctx.putImageData(im, 0, 0);
}

async function ocrCanvas(preprocess) {
  drawCrop(preprocess);
  const opts = {
    tessedit_pageseg_mode: '7',
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.- /'
  };
  const res = await Tesseract.recognize($('cropCanvas'), 'fra+eng', opts);
  return res.data.text || '';
}

async function runOCR() {
  if (!selectedImage) { alert('Ajoute une photo.'); return; }
  $('status').textContent = 'OCR en cours...';
  let texts = [];
  try {
    $('status').textContent = 'OCR variante 1/3...';
    texts.push(await ocrCanvas('normal'));
    $('status').textContent = 'OCR variante 2/3...';
    texts.push(await ocrCanvas('bw'));
    $('status').textContent = 'OCR variante 3/3...';
    texts.push(await ocrCanvas('invert'));
  } catch (e) {
    $('status').textContent = 'Erreur OCR : ' + (e.message || e);
    return;
  }
  const text = texts.join('\n---\n');
  $('ocrText').textContent = text;
  $('status').textContent = 'OCR terminé. Recherche terminée.';
  renderResult(text, 'ocr');
}

$('ocrBtn').onclick = runOCR;
$('manualBtn').onclick = () => renderResult($('manual').value, 'manual');
$('manual').addEventListener('keydown', e => { if (e.key === 'Enter') renderResult($('manual').value, 'manual'); });
$('resetBtn').onclick = () => location.reload();
