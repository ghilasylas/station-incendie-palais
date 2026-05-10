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


function tokensForMatch(value) {
  return normalizeText(value)
    .split(/[^A-Z0-9]+/)
    .filter(t => t.length >= 3 && !['NON','PM','PMS','PRES','NIV','NIVEAU'].includes(t));
}

function getDoorCodes(value) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  return [...new Set((text.match(/\b\d{1,2}\s*[- ]\s*\d{3,5}[A-Z]?(?:\.\d)?\b/g) || [])
    .map(x => x.replace(/\s+/g, '').replace(/(\d{1,2})-(\d+)/, '$1-$2')) )];
}

function getIdentCodes(value) {
  const text = normalizeText(value);
  return [...new Set((text.match(/\b\d{1,2}\s*[-/]\s*\d{1,3}\s*\/\s*\d{1,3}\b/g) || [])
    .map(x => x.replace(/\s+/g, '').replace(/\//g, '/')) )];
}

function getLevels(value) {
  const text = normalizeText(value).replace(/O/g, '0');
  return [...new Set((text.match(/\b(?:N\.?\s*)?1[45]\d{3}\b/g) || [])
    .map(x => (x.match(/1[45]\d{3}/) || [''])[0]).filter(Boolean))];
}

function stationScore(station, query) {
  const qText = normalizeText(query);
  const qCode = normalizeCode(query);
  const blobText = stationSearchBlob(station);
  const blobCode = stationCodeBlob(station);
  let score = 0;
  const reasons = [];

  const id = normalizeCode(station.identification);
  if (id && qCode && (id === qCode || qCode.includes(id) || id.includes(qCode))) {
    score += 100; reasons.push('identification');
  }

  for (const code of getDoorCodes(query)) {
    const c = normalizeCode(code);
    if (c.length >= 5 && blobCode.includes(c)) {
      score += 85; reasons.push(`porte/local ${code}`);
    }
  }

  for (const code of getIdentCodes(query)) {
    const c = normalizeCode(code);
    if (id && (id === c || id.includes(c) || c.includes(id))) {
      score += 100; reasons.push(`identification ${code}`);
    }
  }

  for (const level of getLevels(query)) {
    if (String(station.niveau || '').includes(level)) {
      score += 8; reasons.push(`niveau ${level}`);
    }
  }

  const qTokens = tokensForMatch(query);
  const stationTokens = tokensForMatch(station.station + ' ' + station.description + ' ' + station.localisation);
  for (const t of qTokens) {
    if (blobText.includes(t)) {
      let w = 4;
      if (['VIGER','HALL','GARAGE','VESTIAIRE','SORTIE','PORTE','CAFE','MELK','SUD','NORD','OUEST','EST'].includes(t)) w = 10;
      score += w; reasons.push(t);
    }
  }

  // pénalité si la requête est trop vague (ex: S1, S.7, N.15000 uniquement)
  const onlyWeak = qTokens.length === 0 && getDoorCodes(query).length === 0 && getIdentCodes(query).length === 0;
  if (onlyWeak) score = 0;

  return { station, score, reasons: [...new Set(reasons)] };
}

function findBestStations(query, minScore = 12) {
  return stations
    .map(s => stationScore(s, query))
    .filter(x => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
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

function findStation(query, minScore = 12) {
  const best = findBestStations(query, minScore);
  return best.length ? best[0].station : null;
}

function findStationForOcr(query) {
  // OCR : on exige une correspondance forte pour éviter les faux résultats comme "S1".
  const best = findBestStations(query, 24);
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
      <br><br>Tape manuellement un élément visible, par exemple : <b>15-602</b>, <b>PM HALL VIGER SUD</b>, <b>VIGER</b> ou <b>15400</b>.
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

function detectRedScreenArea(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0, count = 0;

  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // Zone rouge/orangée du panneau incendie
      if (r > 120 && g < 110 && b < 120 && r > g * 1.25) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count++;
      }
    }
  }

  if (count < 80) return null;
  const padX = Math.round(width * 0.04);
  const padTop = Math.round(height * 0.10); // inclure la bande violette avec le texte
  const padBottom = Math.round(height * 0.02);
  return {
    x: Math.max(0, minX - padX),
    y: Math.max(0, minY - padTop),
    w: Math.min(width, maxX + padX) - Math.max(0, minX - padX),
    h: Math.min(height, maxY + padBottom) - Math.max(0, minY - padTop)
  };
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

function canvasToDataUrl(canvas) {
  return canvas.toDataURL('image/png');
}

async function runOcrOnCanvas(canvas, label) {
  const result = await Tesseract.recognize(canvas, 'eng+fra', {
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
  const redBox = detectRedScreenArea(baseCanvas);
  const candidates = [];

  if (redBox) {
    const redCrop = cropCanvas(baseCanvas, redBox);
    candidates.push({ label: 'Lecture OCR de la zone rouge ciblée', canvas: preprocessForOcr(redCrop), raw: redCrop });
    cropPreview.src = canvasToDataUrl(redCrop);
    cropPreview.hidden = false;
  } else {
    cropPreview.hidden = true;
  }

  // Bande où se trouve habituellement la ligne violette avec le code.
  const hBand = Math.round(baseCanvas.height * 0.26);
  const yBand = Math.round(baseCanvas.height * 0.24);
  candidates.push({
    label: 'Lecture OCR de la bande du code',
    canvas: preprocessForOcr(cropCanvas(baseCanvas, { x: 0, y: yBand, w: baseCanvas.width, h: hBand }))
  });

  candidates.push({ label: 'Lecture OCR complète', canvas: preprocessForOcr(baseCanvas) });

  let allText = '';
  let best = null;

  for (const item of candidates) {
    const text = await runOcrOnCanvas(item.canvas, item.label);
    allText += '\n' + text;

    const possibleCodes = extractPossibleCodes(text);
    for (const code of possibleCodes) {
      const attempt = findStationForOcr(code);
      if (attempt && (!best || attempt.score > best.score)) best = { ...attempt, usedCode: code };
    }

    const attemptFull = findStationForOcr(text);
    if (attemptFull && (!best || attemptFull.score > best.score)) best = { ...attemptFull, usedCode: text.trim() };
  }

  lastOcrText = allText.trim();
  ocrTextBox.textContent = lastOcrText || 'Aucun texte OCR lisible.';
  ocrTextBox.hidden = false;

  // Ajout : si l’OCR contient VIGER/HALL/15400 mais pas assez fort, proposer les 5 meilleures options sans choisir automatiquement.
  const suggestions = findBestStations(lastOcrText, 12);
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
