let stations = [];
let selectedImage = null;

const imageInput = document.getElementById('imageInput');
const preview = document.getElementById('preview');
const btnOcr = document.getElementById('btnOcr');
const btnClear = document.getElementById('btnClear');
const btnSearch = document.getElementById('btnSearch');
const manualCode = document.getElementById('manualCode');
const keywordSearch = document.getElementById('keywordSearch');
const keywordResults = document.getElementById('keywordResults');
const statusBox = document.getElementById('status');
const detectedBox = document.getElementById('detected');
const resultBox = document.getElementById('result');

async function loadStations() {
  try {
    const response = await fetch('stations.json');
    stations = await response.json();
    statusBox.textContent = `Base chargée : ${stations.length} stations disponibles.`;
  } catch (error) {
    statusBox.textContent = "Erreur : impossible de charger stations.json. Lance l'application avec un petit serveur local.";
  }
}

function normalizeText(value) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCode(value) {
  return normalizeText(value)
    .replace(/[O]/g, '0')
    .replace(/[I|L]/g, '1')
    .replace(/\s/g, '')
    .replace(/[^A-Z0-9\/\-.]/g, '');
}

function extractPossibleCodes(text) {
  const cleaned = normalizeCode(text);
  const matches = cleaned.match(/[0-9A-Z]{1,4}[-\/][0-9A-Z]{1,6}(?:[-\/][0-9A-Z]{1,6})?/g) || [];
  const extra = cleaned.match(/[0-9]{2}-[0-9]{3,5}/g) || [];
  return [...new Set([...matches, ...extra, cleaned].filter(c => c.length >= 2))];
}

function stationSearchBlob(station) {
  return normalizeCode([
    station.identification,
    station.station,
    station.etage,
    station.niveau,
    station.localisation,
    station.description
  ].join(' '));
}

function findStation(query) {
  const q = normalizeCode(query);
  if (!q) return null;

  // 1. Correspondance exacte sur identification
  let found = stations.find(s => normalizeCode(s.identification) === q);
  if (found) return found;

  // 2. Correspondance partielle dans identification ou nom de station
  found = stations.find(s => normalizeCode(s.identification).includes(q) || normalizeCode(s.station).includes(q));
  if (found) return found;

  // 3. Recherche large
  found = stations.find(s => stationSearchBlob(s).includes(q));
  return found || null;
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
      <h3>Station trouvée</h3>
      <div class="info-grid">
        <strong>N°</strong><span>${escapeHtml(station.no)}</span>
        <strong>Station</strong><span>${escapeHtml(station.station)}</span>
        <strong>Identification</strong><span>${escapeHtml(station.identification || 'Non renseignée')}</span>
        <strong>Étage</strong><span>${escapeHtml(station.etage)}</span>
        <strong>Niveau</strong><span>${escapeHtml(station.niveau)}</span>
        <strong>Secteur</strong><span>${escapeHtml(station.localisation)}</span>
      </div>
      <div class="description">
        Localisation : ${escapeHtml(station.description)}
      </div>
    </div>
  `;
}

function displayNoResult(query) {
  detectedBox.textContent = `Code détecté / recherché : ${query || '—'}`;
  resultBox.innerHTML = `
    <div class="no-result">
      Aucun résultat trouvé. Vérifie le code ou utilise la recherche par mots-clés.
    </div>
  `;
}

function searchAndDisplay(query) {
  const station = findStation(query);
  if (station) displayStation(station, query);
  else displayNoResult(query);
}

imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (!file) return;
  selectedImage = file;
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  btnOcr.disabled = false;
  statusBox.textContent = 'Photo chargée. Clique sur “Lire la photo avec OCR”.';
});

btnOcr.addEventListener('click', async () => {
  if (!selectedImage) return;
  btnOcr.disabled = true;
  statusBox.textContent = 'Lecture OCR en cours...';

  try {
    const result = await Tesseract.recognize(selectedImage, 'eng+fra', {
      logger: info => {
        if (info.status === 'recognizing text') {
          const pct = Math.round((info.progress || 0) * 100);
          statusBox.textContent = `Lecture OCR en cours... ${pct}%`;
        }
      }
    });

    const text = result.data.text || '';
    const possibleCodes = extractPossibleCodes(text);

    statusBox.textContent = 'OCR terminé. Recherche du code...';

    let found = null;
    let usedCode = '';

    for (const code of possibleCodes) {
      found = findStation(code);
      if (found) {
        usedCode = code;
        break;
      }
    }

    if (found) displayStation(found, usedCode);
    else displayNoResult(possibleCodes[0] || text.trim());
  } catch (error) {
    statusBox.textContent = 'Erreur OCR. Essaie avec une photo plus claire ou utilise la recherche manuelle.';
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

  const results = stations.filter(s => normalizeText([
    s.identification, s.station, s.etage, s.niveau, s.localisation, s.description
  ].join(' ')).includes(q)).slice(0, 20);

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
      ${escapeHtml(station.etage)} — ${escapeHtml(station.localisation)}<br>
      ${escapeHtml(station.description)}
    `;
    div.addEventListener('click', () => displayStation(station, station.identification || station.station));
    keywordResults.appendChild(div);
  });
});

btnClear.addEventListener('click', () => {
  selectedImage = null;
  imageInput.value = '';
  manualCode.value = '';
  keywordSearch.value = '';
  keywordResults.innerHTML = '';
  preview.hidden = true;
  preview.src = '';
  btnOcr.disabled = true;
  detectedBox.textContent = 'Code détecté : —';
  resultBox.innerHTML = '';
  statusBox.textContent = `Base chargée : ${stations.length} stations disponibles.`;
});

loadStations();
