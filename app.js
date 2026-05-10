let stations = [];
let selectedImage = null;
let lastOcrText = '';

const imageInput = document.getElementById('imageInput');
const preview = document.getElementById('preview');
const cropPreview = document.getElementById('cropPreview');
const btnOcr = document.getElementById('btnOcr');
const btnClear = document.getElementById('btnClear');
const btnSearch = document.getElementById('btnSearch');
const manualCode = document.getElementById('manualCode');
const keywordSearch = document.getElementById('keywordSearch');
const keywordResults = document.getElementById('keywordResults');
const statusBox = document.getElementById('status');
const detectedBox = document.getElementById('detected');
const resultBox = document.getElementById('result');
const ocrTextBox = document.getElementById('ocrText');

async function loadStations() {
  try {
    const response = await fetch('stations.json', { cache: 'no-store' });
    stations = await response.json();
    statusBox.textContent = `Base chargée : ${stations.length} stations disponibles.`;
  } catch (error) {
    statusBox.textContent = "Erreur : impossible de charger stations.json. Lance l'application avec un serveur ou GitHub Pages.";
  }
}

function normalizeText(value) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCode(value) {
  return normalizeText(value)
    .replace(/[OQ]/g, '0')
    .replace(/[I|L]/g, '1')
    .replace(/[’']/g, '')
    .replace(/\s/g, '')
    .replace(/[^A-Z0-9\/\-.]/g, '');
}

function stationSearchBlob(station) {
  return normalizeText([
    station.no,
    station.identification,
    station.station,
    station.etage,
    station.niveau,
    station.localisation,
    station.description
  ].join(' '));
}

function stationCodeBlob(station) {
  return normalizeCode(stationSearchBlob(station));
}



function stationStationText(station) {
  return normalizeText(station.station || '')
    .replace(/P\s*\.\s*M\s*\.?/g, 'PM ')
    .replace(/\bP\s*HAL\b/g, 'HALL')
    .replace(/\bP\.HAL\b/g, 'HALL')
    .replace(/\bREST\.?\b/g, 'RESTAURANT')
    .replace(/\bVESTI\.?\b/g, 'VESTIAIRE')
    .replace(/\bCORR\.?\b/g, 'CORRIDOR')
    .replace(/\bCH\.?\b/g, 'CHAMBRE')
    .replace(/\bELEC\.?\b/g, 'ELECTRIQUE')
    .replace(/\bNIV\.?\b/g, 'NIVEAU')
    .replace(/\s+/g, ' ')
    .trim();
}

function ocrClean(value) {
  // Corrige les erreurs OCR fréquentes seulement pour la recherche.
  return normalizeText(value)
    .replace(/[’']/g, '')
    .replace(/P\s*\.\s*M\s*\.?/g, 'PM ')
    .replace(/P\s*M/g, 'PM')
    .replace(/\bP\s*HAL\b/g, 'HALL')
    .replace(/\bP\.HAL\b/g, 'HALL')
    .replace(/\bN\s*[.:]\s*/g, 'N.')
    .replace(/\bS\s*[.:]\s*/g, 'S.')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensForMatch(value) {
  const stop = new Set(['NON','PM','PMS','P','M','NIV','NIVEAU','PRES','PRESSE','PORTE','LOCAL','SORTIE','ENTREE','HALL']);
  return ocrClean(value)
    .split(/[^A-Z0-9]+/)
    .filter(t => t.length >= 3 && !stop.has(t));
}

function stationTokens(station) {
  return tokensForMatch(stationStationText(station));
}

function getDoorCodes(value) {
  const text = ocrClean(value)
    .replace(/[OQ]/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/B/g, '8')
    .replace(/G/g, '6');
  const matches = [];
  // 15-602, 15 602, 22-100, 28-430, 16-104, 14.5 accepté aussi
  (text.match(/\b\d{1,2}\s*[- ]\s*\d{3,5}[A-Z]?(?:\.\d)?\b/g) || []).forEach(m => {
    matches.push(m.replace(/\s+/g, '').replace(/(\d{1,2})-(\d+)/, '$1-$2'));
  });
  return [...new Set(matches)];
}

function getIdentCodes(value) {
  const text = ocrClean(value).replace(/[OQ]/g, '0').replace(/[IL|]/g, '1');
  return [...new Set((text.match(/\b\d{1,2}\s*[-/]\s*\d{1,3}\s*\/\s*\d{1,3}\b/g) || [])
    .map(x => x.replace(/\s+/g, '').replace(/\//g, '/')) )];
}

function getLevels(value) {
  const text = ocrClean(value).replace(/[OQ]/g, '0').replace(/[IL|]/g, '1');
  return [...new Set((text.match(/\b(?:N\.?\s*)?\d{5}\b/g) || [])
    .map(x => (x.match(/\d{5}/) || [''])[0]).filter(Boolean))];
}

function compactStation(value) {
  return normalizeCode(value).replace(/PM/g, '').replace(/NIVEAU/g, '');
}

function stationScore(station, query) {
  const qText = ocrClean(query);
  const qCode = normalizeCode(qText);
  const blobText = stationSearchBlob(station);
  const stationName = stationStationText(station);
  const stationNameCode = compactStation(stationName);
  const blobCode = stationCodeBlob(station);
  let score = 0;
  let strong = false;
  const reasons = [];

  const id = normalizeCode(station.identification);
  if (id && qCode.length >= 4 && (id === qCode || qCode.includes(id) || id.includes(qCode))) {
    score += 140; strong = true; reasons.push('identification exacte');
  }

  const qDoors = getDoorCodes(qText);
  const sDoors = getDoorCodes(station.station + ' ' + station.description + ' ' + station.identification);
  for (const code of qDoors) {
    const c = normalizeCode(code);
    if (sDoors.map(normalizeCode).includes(c) || blobCode.includes(c)) {
      score += 180; strong = true; reasons.push(`code porte/local ${code}`);
    }
  }

  for (const code of getIdentCodes(qText)) {
    const c = normalizeCode(code);
    if (id && (id === c || id.includes(c) || c.includes(id))) {
      score += 150; strong = true; reasons.push(`identification ${code}`);
    }
  }

  // Correspondance du nom de station, utile pour les stations sans numéro : CAFE MELK, POSTE CANADA, VIGER SUD, etc.
  const qTokens = tokensForMatch(qText);
  const sTokens = stationTokens(station);
  let tokenHits = 0;
  for (const t of qTokens) {
    if (sTokens.includes(t) || blobText.includes(t)) {
      tokenHits++;
      let w = 12;
      if (['VIGER','MELK','CANADA','MONOPOLIE','JEANNE','MANCE','VESTIAIRE','PARKING','GARAGE','VIP','PIETON','QIM','ACCUEIL'].includes(t)) w = 25;
      if (/^ESC[A-Z0-9]*/.test(t)) w = 20;
      score += w; reasons.push(t);
    }
  }
  if (tokenHits >= 2) strong = true;

  // Si la requête contient presque exactement le libellé de la colonne Station manuelle.
  const qCompact = compactStation(qText);
  if (qCompact.length >= 6 && (stationNameCode.includes(qCompact) || qCompact.includes(stationNameCode))) {
    score += 100; strong = true; reasons.push('libellé station');
  }

  for (const level of getLevels(qText)) {
    if (String(station.niveau || '').includes(level)) {
      score += 6; reasons.push(`niveau ${level}`);
    }
  }

  // Niveau seul, secteur seul, S1/S2 seul = jamais suffisant.
  if (!strong) score = Math.min(score, 20);

  return { station, score, reasons: [...new Set(reasons)], strong };
}

function findBestStations(query, minScore = 25, requireStrong = false) {
  return stations
    .map(s => stationScore(s, query))
    .filter(x => x.score >= minScore && (!requireStrong || x.strong))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function extractPossibleCodes(text) {
  const normalized = normalizeText(text)
    .replace(/O/g, '0')
    .replace(/[I|L]/g, '1');
  const compact = normalizeCode(text);
  const candidates = [];

  // Exemples : 15-602, 15 602, 2-19120, 18-24/25, 2018-10-11
  const patterns = [
    /\b\d{1,4}\s*[-/]\s*\d{2,6}(?:\s*[-/]\s*\d{1,6})?\b/g,
    /\b\d{1,2}\s+\d{3,5}\b/g,
    /\bN\.?\s*\d{4,6}\b/g,
    /\bS\.?\s*\d{1,2}\b/g,
    /\bPM\s+[A-Z0-9 .'-]+\b/g
  ];

  patterns.forEach((regex) => {
    const matches = normalized.match(regex) || [];
    matches.forEach((m) => candidates.push(m.replace(/\s*[-/]\s*/g, '-').replace(/\s+/g, ' ').trim()));
  });

  const compactMatches = compact.match(/[0-9A-Z]{1,4}[-\/][0-9A-Z]{1,6}(?:[-\/][0-9A-Z]{1,6})?/g) || [];
  compactMatches.forEach((m) => candidates.push(m));

  // Ajoute aussi des morceaux utiles si le panneau affiche PM HALL 15-602 N.15000 S.2
  const stationDoor = normalized.match(/\b\d{1,2}[- ]\d{3,5}\b/g) || [];
  stationDoor.forEach((m) => candidates.push(m.replace(' ', '-')));

  return [...new Set(candidates.filter(c => c && c.length >= 2))];
}

function findStation(query, minScore = 25) {
  const best = findBestStations(query, minScore, false);
  return best.length ? best[0].station : null;
}

function findStationForOcr(query) {
  // OCR : on exige une vraie preuve : code porte/local, identification ou au moins 2 mots distinctifs.
  const best = findBestStations(query, 60, true);
  return best.length ? best[0] : null;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function displayStation(station, searchedCode = '') {
  detectedBox.textContent = `Code détecté / recherché : ${searchedCode || station.identification || station.station}`;
  resultBox.innerHTML = `
    <div class="station-box">
      <h3>✅ Station trouvée</h3>
      <div class="description primary">
        ${escapeHtml(station.description || 'Description non renseignée')}
      </div>
      <div class="info-grid">
        <strong>N°</strong><span>${escapeHtml(station.no)}</span>
        <strong>Station</strong><span>${escapeHtml(station.station)}</span>
        <strong>Identification</strong><span>${escapeHtml(station.identification || 'Non renseignée')}</span>
        <strong>Étage</strong><span>${escapeHtml(station.etage)}</span>
        <strong>Niveau</strong><span>${escapeHtml(station.niveau)}</span>
        <strong>Secteur</strong><span>${escapeHtml(station.localisation)}</span>
      </div>
    </div>
  `;
}

function displayNoResult(query, suggestions = []) {
  detectedBox.textContent = `Code détecté / recherché : ${query || '—'}`;
  const suggestionHtml = suggestions.length ? `
    <div class="suggestions">
      <strong>Résultats possibles :</strong>
      ${suggestions.map(x => `<button type="button" class="suggestion-btn" data-station-no="${escapeHtml(x.station.no)}">${escapeHtml(x.station.station)} — ${escapeHtml(x.station.description)}</button>`).join('')}
    </div>` : '';
  resultBox.innerHTML = `
    <div class="no-result">
      OCR non fiable ou code incomplet. Je préfère ne pas afficher une mauvaise station.
      <br><br>Tape manuellement un élément visible de la ligne du panneau, par exemple : <b>15-602</b>, <b>VIGER</b>, <b>CAFE MELK</b>, <b>POSTE CANADA</b>. Le niveau seul comme <b>N.15000</b> ou le secteur seul comme <b>S.2</b> ne suffit pas.
    </div>
    ${suggestionHtml}
  `;
  resultBox.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const st = stations.find(s => String(s.no) === btn.dataset.stationNo);
      if (st) displayStation(st, query);
    });
  });
}

function searchAndDisplay(query) {
  const station = findStation(query);
  if (station) displayStation(station, query);
  else displayNoResult(query);
}

function loadImageToCanvas(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 1600;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function detectRedPixelsArea(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0, count = 0;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // Écran rouge/orange du panneau. On s'en sert comme repère.
      if (r > 115 && g < 130 && b < 130 && r > g * 1.15 && r > b * 1.25) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count++;
      }
    }
  }

  if (count < 80) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function detectRedScreenArea(canvas) {
  const red = detectRedPixelsArea(canvas);
  if (!red) return null;
  const { width, height } = canvas;
  const padX = Math.round(width * 0.04);
  const padTop = Math.round(height * 0.10);
  const padBottom = Math.round(height * 0.02);
  return {
    x: Math.max(0, red.x - padX),
    y: Math.max(0, red.y - padTop),
    w: Math.min(width, red.x + red.w + padX) - Math.max(0, red.x - padX),
    h: Math.min(height, red.y + red.h + padBottom) - Math.max(0, red.y - padTop)
  };
}

function detectPmLineArea(canvas) {
  const red = detectRedPixelsArea(canvas);
  if (!red) return null;
  const { width, height } = canvas;

  // Sur le panneau, la bonne information commence souvent par un symbole / ou ✓ puis PM.
  // Elle est sur la bande violette juste AU-DESSUS de la grande zone rouge.
  const bandH = Math.max(42, Math.round(red.h * 0.16));
  const y = Math.max(0, red.y - Math.round(bandH * 1.15));
  const x = Math.max(0, red.x - Math.round(width * 0.035));
  const w = Math.min(width - x, red.w + Math.round(width * 0.09));
  const h = Math.min(height - y, Math.round(bandH * 1.35));
  return { x, y, w, h };
}

function cropCanvas(canvas, box) {
  const out = document.createElement('canvas');
  out.width = box.w;
  out.height = box.h;
  out.getContext('2d').drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return out;
}

function preprocessForOcr(sourceCanvas) {
  const scale = 2;
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width * scale;
  out.height = sourceCanvas.height * scale;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const gray = (r * 0.299 + g * 0.587 + b * 0.114);
    // Contraste simple : texte clair sur bande foncée ou texte foncé sur fond clair
    const v = gray > 145 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function preprocessLineForOcr(sourceCanvas) {
  // Spécialement pour la ligne "/ PM ..." : fort agrandissement + inversion.
  // Le texte est souvent clair sur une bande violette/foncée.
  const scale = 4;
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width * scale;
  out.height = sourceCanvas.height * scale;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const gray = (r * 0.299 + g * 0.587 + b * 0.114);
    // Si c'est clair, on le transforme en noir; sinon fond blanc.
    const v = gray > 135 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function extractPmLine(text) {
  const normalized = normalizeText(text)
    .replace(/[✓✔√]/g, '/')
    .replace(/[\\|]/g, '/')
    .replace(/P\s*M/g, 'PM')
    .replace(/P\.\s*M/g, 'PM')
    .replace(/\s+/g, ' ');

  // Cherche la portion qui commence par /PM ou PM, puis conserve les mots utiles.
  const match = normalized.match(/(?:\/\s*)?PM\s+[A-Z0-9 .'-]+?(?=\s{2,}|$)/);
  if (!match) return '';

  let line = match[0]
    .replace(/^\/\s*/, '')
    .replace(/\b(ALARMES?|SUPERVISORY|SECURITES?|DEFECT|TROUBLE)\b.*$/g, '')
    .trim();

  // Si la ligne contient N.15400 ou S.7, on les garde, car ils aident à choisir.
  const level = normalized.match(/\bN\.?\s*1[45]\d{3}\b/);
  const sector = normalized.match(/\bS\.?\s*\d{1,2}\b/);
  if (level && !line.includes(level[0])) line += ' ' + level[0];
  if (sector && !line.includes(sector[0])) line += ' ' + sector[0];
  return line.trim();
}

function extractUsefulOcrQueries(text) {
  const queries = [];
  const pmLine = extractPmLine(text);
  if (pmLine) queries.push(pmLine);
  extractPossibleCodes(text).forEach(c => queries.push(c));
  const full = normalizeText(text);
  if (full) queries.push(full);
  return [...new Set(queries.filter(q => q && q.length >= 2))];
}

function canvasToDataUrl(canvas) {
  return canvas.toDataURL('image/png');
}

async function runOcrOnCanvas(canvas, label, psm = '6') {
  const result = await Tesseract.recognize(canvas, 'eng+fra', {
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/ .',
    logger: info => {
      if (info.status === 'recognizing text') {
        const pct = Math.round((info.progress || 0) * 100);
        statusBox.textContent = `${label}... ${pct}%`;
      }
    }
  });
  return result.data.text || '';
}

async function ocrAndSearch(file) {
  const baseCanvas = await loadImageToCanvas(file);
  const candidates = [];

  // PRIORITÉ 1 : ligne "/ PM ..." sur la bande violette juste au-dessus de la zone rouge.
  const pmLineBox = detectPmLineArea(baseCanvas);
  if (pmLineBox) {
    const pmLineCrop = cropCanvas(baseCanvas, pmLineBox);
    candidates.push({ label: 'Lecture OCR de la ligne / PM', canvas: preprocessLineForOcr(pmLineCrop), psm: '7', priority: 1, raw: pmLineCrop });
    cropPreview.src = canvasToDataUrl(pmLineCrop);
    cropPreview.hidden = false;
  }

  // PRIORITÉ 2 : zone rouge élargie, seulement comme secours.
  const redBox = detectRedScreenArea(baseCanvas);
  if (redBox) {
    const redCrop = cropCanvas(baseCanvas, redBox);
    candidates.push({ label: 'Lecture OCR de la zone rouge ciblée', canvas: preprocessForOcr(redCrop), psm: '6', priority: 2, raw: redCrop });
    if (!pmLineBox) {
      cropPreview.src = canvasToDataUrl(redCrop);
      cropPreview.hidden = false;
    }
  } else {
    cropPreview.hidden = true;
  }

  // PRIORITÉ 3 : lecture complète seulement en dernier recours.
  candidates.push({ label: 'Lecture OCR complète', canvas: preprocessForOcr(baseCanvas), psm: '6', priority: 3 });

  let allText = '';
  let best = null;

  for (const item of candidates) {
    const text = await runOcrOnCanvas(item.canvas, item.label, item.psm);
    allText += `\n--- ${item.label} ---\n${text}`;

    const queries = extractUsefulOcrQueries(text);
    for (const query of queries) {
      const attempt = findStationForOcr(query);
      if (attempt) {
        // Bonus si la requête vient de la vraie ligne /PM, car c'est le meilleur repère.
        const score = attempt.score + (item.priority === 1 ? 20 : 0);
        if (!best || score > best.score) best = { ...attempt, score, usedCode: query };
      }
    }

    // Si la ligne /PM donne une très bonne correspondance, on arrête avant de polluer avec le reste.
    if (best && item.priority === 1 && best.score >= 34) break;
  }

  lastOcrText = allText.trim();
  ocrTextBox.textContent = lastOcrText || 'Aucun texte OCR lisible.';
  ocrTextBox.hidden = false;

  const suggestions = findBestStations(extractPmLine(lastOcrText) || lastOcrText, 25, false);
  return { found: best?.station || null, usedCode: best?.usedCode || '', allText: lastOcrText, suggestions };
}

imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (!file) return;
  selectedImage = file;
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  cropPreview.hidden = true;
  btnOcr.disabled = false;
  statusBox.textContent = 'Photo chargée. Clique sur “Lire la photo avec OCR”.';
});

btnOcr.addEventListener('click', async () => {
  if (!selectedImage) return;
  btnOcr.disabled = true;
  statusBox.textContent = 'Préparation de la photo...';

  try {
    const { found, usedCode, allText, suggestions } = await ocrAndSearch(selectedImage);
    statusBox.textContent = 'OCR terminé. Recherche terminée.';
    if (found) displayStation(found, usedCode || allText);
    else displayNoResult(extractPossibleCodes(allText)[0] || allText, suggestions);
  } catch (error) {
    console.error(error);
    statusBox.textContent = 'Erreur OCR. Essaie une photo plus droite, plus proche, ou utilise la recherche manuelle.';
  } finally {
    btnOcr.disabled = false;
  }
});

btnSearch.addEventListener('click', () => searchAndDisplay(manualCode.value));
manualCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchAndDisplay(manualCode.value);
});

keywordSearch.addEventListener('input', () => {
  const q = normalizeText(keywordSearch.value);
  keywordResults.innerHTML = '';
  if (q.length < 2) return;

  const results = stations.filter(s => stationSearchBlob(s).includes(q)).slice(0, 20);

  if (results.length === 0) {
    keywordResults.innerHTML = '<div class="no-result">Aucun résultat.</div>';
    return;
  }

  results.forEach(station => {
    const div = document.createElement('div');
    div.className = 'small-result';
    div.innerHTML = `
      <strong>${escapeHtml(station.station)}</strong><br>
      Identification : ${escapeHtml(station.identification || 'Non renseignée')}<br>
      ${escapeHtml(station.etage)} — Niveau ${escapeHtml(station.niveau)} — ${escapeHtml(station.localisation)}<br>
      ${escapeHtml(station.description)}
    `;
    div.addEventListener('click', () => displayStation(station, station.identification || station.station));
    keywordResults.appendChild(div);
  });
});

btnClear.addEventListener('click', () => {
  selectedImage = null;
  lastOcrText = '';
  imageInput.value = '';
  manualCode.value = '';
  keywordSearch.value = '';
  keywordResults.innerHTML = '';
  preview.hidden = true;
  cropPreview.hidden = true;
  ocrTextBox.hidden = true;
  preview.src = '';
  cropPreview.src = '';
  btnOcr.disabled = true;
  detectedBox.textContent = 'Code détecté : —';
  resultBox.innerHTML = '';
  statusBox.textContent = `Base chargée : ${stations.length} stations disponibles.`;
});

loadStations();
