// ────────────────────────────────────────────────
//  MAXIMUM NUMBERS SUPPORT – STREAMING VERSION
// ────────────────────────────────────────────────

const TCPA_API = "https://api.uspeoplesearch.site/tcpa/v1?x=";
const PROXY    = "https://api.allorigins.win/raw?url=";

const fileInput     = document.getElementById('fileInput');
const startBtn      = document.getElementById('startBtn');
const statusEl      = document.getElementById('status');
const progressEl    = document.getElementById('progress');
const resultsEl     = document.getElementById('results');
const stateSelect   = document.getElementById('stateSelect');

const dlDNC         = document.getElementById('dlDNC');
const dlClean       = document.getElementById('dlClean');
const dlStateDNC    = document.getElementById('dlStateDNC');
const dlStateClean  = document.getElementById('dlStateClean');

let dncByState      = {};
let cleanByState    = {};
let totalProcessed  = 0;
let totalDNC        = 0;
let totalClean      = 0;
let isProcessing    = false;

const DELAY_BETWEEN_REQUESTS = 12500;   // 12.5 seconds – very safe
const REQUEST_TIMEOUT_MS     = 28000;
const MAX_RETRIES            = 3;

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;

  const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
  statusEl.textContent = `File ready: ${file.name}  (${sizeMB} MB) — Click "Start Processing"`;
  startBtn.disabled = false;
});

startBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (isProcessing || !file) return;

  isProcessing = true;
  startBtn.disabled = true;
  fileInput.disabled = true;

  dncByState = {};
  cleanByState = {};
  totalProcessed = totalDNC = totalClean = 0;

  resultsEl.innerHTML = '';
  stateSelect.innerHTML = '<option value="">All States</option>';

  dlDNC.disabled = dlClean.disabled = true;
  dlStateDNC.disabled = dlStateClean.disabled = true;

  statusEl.textContent = "Starting streaming process...";
  progressEl.textContent = "Processed: 0 | DNC: 0 | Clean: 0";

  try {
    await streamAndProcessFile(file);
  } catch (err) {
    statusEl.textContent = `Critical error: ${err.message}`;
    console.error(err);
  } finally {
    finish();
  }
});

async function streamAndProcessFile(file) {
  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
  let lineCounter = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let lines;
    [lines, buffer] = getCompleteLines(buffer);

    for (const rawLine of lines) {
      const phone = rawLine.trim();
      if (phone.length !== 10 || !/^\d{10}$/.test(phone)) continue;

      lineCounter++;
      totalProcessed++;

      await checkNumber(phone);

      if (lineCounter % 50 === 0) {
        updateProgress();
      }
    }

    // Prevent UI freeze on very large files
    if (lineCounter % 300 === 0) {
      await new Promise(r => setTimeout(r, 80));
    }
  }

  // Process any remaining line in buffer
  if (buffer.trim()) {
    const phone = buffer.trim();
    if (/^\d{10}$/.test(phone)) {
      totalProcessed++;
      await checkNumber(phone);
    }
  }

  updateProgress();
  statusEl.textContent = `Completed – ${totalProcessed.toLocaleString()} valid numbers checked`;
}

function getCompleteLines(buffer) {
  const parts = buffer.split(/\r?\n/);
  const complete = parts.slice(0, -1);
  const leftover = parts[parts.length - 1];
  return [complete, leftover];
}

async function checkNumber(phone) {
  let retries = 0;
  let success = false;

  while (retries < MAX_RETRIES && !success) {
    try {
      const data = await safeFetchTCPA(phone);
      const state = data.state || "Unknown";

      if (!dncByState[state]) dncByState[state] = [];
      if (!cleanByState[state]) cleanByState[state] = [];

      const isDNC = (data.ndnc === "Yes" || data.sdnc === "Yes");

      if (isDNC) {
        dncByState[state].push(phone);
        totalDNC++;
        append(`<span class="dnc">${phone}</span> → DNC <span class="small">(${state})</span>`);
      } else {
        cleanByState[state].push(phone);
        totalClean++;
        append(`<span class="clean">${phone}</span> → Clean <span class="small">(${state})</span>`);
      }

      success = true;
    } catch (err) {
      retries++;
      append(`<span class="error">${phone} → Error (retry ${retries}/${MAX_RETRIES})</span>`);

      if (retries < MAX_RETRIES) {
        await delay(6000); // wait before retry
      }
    }
  }

  if (!success) {
    append(`<span class="error">${phone} → Failed after ${MAX_RETRIES} attempts</span>`);
  }

  // Main safety delay – do NOT reduce below 10 seconds
  await delay(DELAY_BETWEEN_REQUESTS);
}

async function safeFetchTCPA(phone) {
  const fullUrl = TCPA_API + phone;
  const proxyUrl = PROXY + encodeURIComponent(fullUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(proxyUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const text = await response.text();
    const json = JSON.parse(text);

    if (json.status !== "ok") {
      throw new Error("API returned non-ok status");
    }

    return json;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Request timeout");
    }
    throw err;
  }
}

function append(html) {
  const p = document.createElement('p');
  p.innerHTML = html;
  resultsEl.appendChild(p);
  resultsEl.scrollTop = resultsEl.scrollHeight;
}

function updateProgress() {
  progressEl.textContent = 
    `Processed: ${totalProcessed.toLocaleString()} | DNC: ${totalDNC.toLocaleString()} | Clean: ${totalClean.toLocaleString()}`;
}

function finish() {
  isProcessing = false;
  startBtn.disabled = false;
  fileInput.disabled = false;

  populateStateDropdown();
  dlDNC.disabled = false;
  dlClean.disabled = false;
  dlStateDNC.disabled = false;
  dlStateClean.disabled = false;
}

function populateStateDropdown() {
  const states = new Set([
    ...Object.keys(dncByState),
    ...Object.keys(cleanByState)
  ]);

  stateSelect.innerHTML = '<option value="">All States</option>';
  [...states].sort().forEach(state => {
    const option = document.createElement('option');
    option.value = state;
    option.textContent = state;
    stateSelect.appendChild(option);
  });
}

// ─── Download Handlers ────────────────────────────────────────

dlDNC.addEventListener('click', () => {
  const content = Object.values(dncByState).flat().join('\n');
  saveFile("dnc_all.txt", content);
});

dlClean.addEventListener('click', () => {
  const content = Object.values(cleanByState).flat().join('\n');
  saveFile("clean_all.txt", content);
});

dlStateDNC.addEventListener('click', () => {
  const state = stateSelect.value;
  if (!state) return alert("Select a state first");
  const nums = dncByState[state] || [];
  saveFile(`dnc_${state}.txt`, nums.join('\n'));
});

dlStateClean.addEventListener('click', () => {
  const state = stateSelect.value;
  if (!state) return alert("Select a state first");
  const nums = cleanByState[state] || [];
  saveFile(`clean_${state}.txt`, nums.join('\n'));
});

function saveFile(filename, text) {
  if (!text.trim()) {
    alert("No numbers to save in this category");
    return;
  }
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
