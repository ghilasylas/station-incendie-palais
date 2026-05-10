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

function findStation(query) {
  const qText = normalizeText(query);
  const qCode = normalizeCode(query);
  if (!qText && !qCode) return null;

  // 1. Correspondance exacte sur identification
  let found = stations.find(s => normalizeCode(s.identification) === qCode);
  if (found) return found;

  // 2. Correspondance exacte/partielle sur station ou identification
  found = stations.find(s => {
    const id = normalizeCode(s.identification);
    const st = normalizeCode(s.station);
    return (id && (id.includes(qCode) || qCode.includes(id))) || st.includes(qCode) || qCode.includes(st);
  });
  if (found) return found;

  // 3. Si le code contient 15-602, 15 602, etc.
  const codes = extractPossibleCodes(query).map(normalizeCode);
  for (const c of codes) {
    found = stations.find(s => stationCodeBlob(s).includes(c) || c.includes(normalizeCode(s.station)));
    if (found) return found;
  }

  // 4. Recherche large
  found = stations.find(s => stationCodeBlob(s).includes(qCode));
  if (found) return found;

  // 5. Score approximatif avec les mots reconnus par OCR
  const queryTokens = normalizeText(query).split(/[^A-Z0-9]+/).filter(t => t.length >= 2);
  let best = null;
  let bestScore = 0;
  for (const s of stations) {
    const blob = stationSearchBlob(s);
    let score = 0;
    for (const token of queryTokens) {
      if (blob.includes(token)) score += token.length >= 4 ? 3 : 1;
    }
    // priorité aux codes de porte/niveau
    const doorCodes = (blob.match(/\b\d{1,2}-\d{3,5}\b/g) || []);
    for (const dc of doorCodes) {
      if (qText.includes(dc) || qCode.includes(normalizeCode(dc))) score += 10;
    }
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return bestScore >= 6 ? best : null;
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

function displayNoResult(query) {
  detectedBox.textContent = `Code détecté / recherché : ${query || '—'}`;
  resultBox.innerHTML = `
    <div class="no-result">
      Aucun résultat trouvé. Essaie avec la recherche manuelle : par exemple seulement <b>15-602</b> ou un mot comme <b>garage</b>.
    </div>
  `;
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

  // Candidat secours : bande centrale de la photo
  const hBand = Math.round(baseCanvas.height * 0.42);
  const yBand = Math.round(baseCanvas.height * 0.22);
  candidates.push({
    label: 'Lecture OCR de la zone centrale',
    canvas: preprocessForOcr(cropCanvas(baseCanvas, { x: 0, y: yBand, w: baseCanvas.width, h: hBand }))
  });

  // Dernier secours : photo complète réduite
  candidates.push({ label: 'Lecture OCR complète', canvas: preprocessForOcr(baseCanvas) });

  let allText = '';
  let found = null;
  let usedCode = '';

  for (const item of candidates) {
    const text = await runOcrOnCanvas(item.canvas, item.label);
    allText += '\n' + text;
    const possibleCodes = extractPossibleCodes(text);

    for (const code of possibleCodes) {
      found = findStation(code);
      if (found) {
        usedCode = code;
        break;
      }
    }

    if (!found) {
      found = findStation(text);
      usedCode = possibleCodes[0] || text.trim();
    }
    if (found) break;
  }

  lastOcrText = allText.trim();
  ocrTextBox.textContent = lastOcrText || 'Aucun texte OCR lisible.';
  ocrTextBox.hidden = false;
  return { found, usedCode, allText: lastOcrText };
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
    const { found, usedCode, allText } = await ocrAndSearch(selectedImage);
    statusBox.textContent = 'OCR terminé. Recherche terminée.';
    if (found) displayStation(found, usedCode || allText);
    else displayNoResult(extractPossibleCodes(allText)[0] || allText);
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
