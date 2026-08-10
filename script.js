// PASTE your deployed Apps Script Web App URL here (ends in /exec):
const API_URL = 'https://script.google.com/macros/s/AKfycbw9yEAB-kOOOtp3zxZbNy-UnROPMFSUKw2LIIVaQL7lZIGR9-t8Hiyr3163WsWAukAD6w/exec';
const THEME_KEY = 'mrf_form_theme';

// ===================== THEME (light / dark) =====================

(function () {
  const toggle = document.getElementById('themeToggle');
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    toggle.textContent = theme === 'light' ? '\u2600\uFE0F' : '\uD83C\uDF19';
    localStorage.setItem(THEME_KEY, theme);
  }
  toggle.addEventListener('click', function () {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'light' ? 'dark' : 'light');
  });
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
})();

// ===================== API HELPERS =====================
// Same defensive JSON handling as the inventory app: Apps Script can
// occasionally return an HTML error page instead of JSON under load, so we
// parse safely and retry once before giving up.

async function parseJsonResponse_(resp) {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Server returned a non-JSON response (likely a temporary Apps Script hiccup).');
    err.isNonJson = true;
    throw err;
  }
}

async function apiGet(action, params, _isRetry) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  if (params) {
    Object.keys(params).forEach(function (k) { url.searchParams.set(k, params[k]); });
  }
  let resp;
  try {
    resp = await fetch(url.toString());
  } catch (networkErr) {
    throw new Error('Could not reach the server (network/CORS error). If this just started after a backend change, the Apps Script project likely needs re-authorization + a new deployment — see mrf_backend.gs\'s setup notes.');
  }
  try {
    return await parseJsonResponse_(resp);
  } catch (err) {
    if (err.isNonJson && !_isRetry) {
      await new Promise(function (r) { setTimeout(r, 600); });
      return apiGet(action, params, true);
    }
    throw err;
  }
}

async function apiPost(action, payload, _isRetry) {
  let resp;
  try {
    resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
      body: JSON.stringify({ action: action, payload: payload })
    });
  } catch (networkErr) {
    throw new Error('Could not reach the server (network/CORS error). If this just started after a backend change, the Apps Script project likely needs re-authorization + a new deployment — see mrf_backend.gs\'s setup notes.');
  }
  try {
    return await parseJsonResponse_(resp);
  } catch (err) {
    if (err.isNonJson && !_isRetry) {
      await new Promise(function (r) { setTimeout(r, 600); });
      return apiPost(action, payload, true);
    }
    throw err;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Local YYYY-MM-DD (avoids the UTC-shift issue with toISOString for date-only inputs).
function todayIso_() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// Turns a base64 PDF string (from the backend's Google Sheets export) into
// an actual browser download. No PDF-drawing here — the bytes already ARE
// a PDF, rendered server-side straight from the "MRF Print" tab.
function downloadPdfFromBase64_(base64, fileName) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// ===================== FORM ELEMENTS =====================

const mrfPreviewEl = document.getElementById('mrfPreview');
const projectNameInput = document.getElementById('projectName');
const soNumberInput = document.getElementById('soNumber');
const lobSelect = document.getElementById('lob');
const mrfDateInput = document.getElementById('mrfDate');
const requestorSelect = document.getElementById('requestor');
const requestorErrorEl = document.getElementById('requestorError');
const requestedByInput = document.getElementById('requestedBy');
const procurementDeadlineInput = document.getElementById('procurementDeadline');
const productionDeadlineInput = document.getElementById('productionDeadline');

const itemRequestedInput = document.getElementById('itemRequested');
const itemRequestedListEl = document.getElementById('itemRequestedList');
const itemQtyInput = document.getElementById('itemQty');
const itemUomInput = document.getElementById('itemUom');
const itemSizeInput = document.getElementById('itemSize');
const addItemBtn = document.getElementById('addItemBtn');

const tableBody = document.querySelector('#itemTable tbody');
const itemCountEl = document.getElementById('itemCount');
const submitAllBtn = document.getElementById('submitAllBtn');
const msg = document.getElementById('msg');

let pending = [];

// ===================== MRF# PREVIEW =====================
// Unreserved — just shows what the number WOULD be right now (already
// formatted as e.g. "MRF264200" by the backend). The real number is
// assigned atomically by the backend at submit time and may differ
// slightly if someone else submitted in between.

async function loadMrfPreview() {
  try {
    const res = await apiGet('getNextMrfPreview');
    if (res.error) { mrfPreviewEl.textContent = 'error'; return; }
    mrfPreviewEl.textContent = res.mrfNumber;
  } catch (err) {
    mrfPreviewEl.textContent = 'error';
  }
}

// ===================== DROPDOWNS (pulled live from Smartsheet's own options) =====================

function fillSelect(selectEl, options, placeholder) {
  selectEl.innerHTML = '';
  const optEl = document.createElement('option');
  optEl.value = '';
  optEl.textContent = placeholder;
  selectEl.appendChild(optEl);
  options.forEach(function (val) {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = val;
    selectEl.appendChild(o);
  });
}

async function loadLobOptions() {
  try {
    const options = await apiGet('getLobOptions');
    if (options.error) throw new Error(options.error);
    fillSelect(lobSelect, options, 'Select LOB');
    if (options.indexOf('ACP') !== -1) lobSelect.value = 'ACP';
  } catch (err) {
    fillSelect(lobSelect, [], 'Not available');
  }
}

async function loadRequestorOptions() {
  try {
    const options = await apiGet('getRequestorOptions');
    if (options.error) throw new Error(options.error);
    fillSelect(requestorSelect, options, 'Select Requestor');
    requestorErrorEl.classList.add('hidden');
  } catch (err) {
    fillSelect(requestorSelect, [], 'Not available');
    requestorErrorEl.textContent = err.message || String(err);
    requestorErrorEl.classList.remove('hidden');
  }
}

// ===================== ITEM SUGGESTIONS (not a strict dropdown) =====================
// Populates the datalist from the inventory sheet's "Item" column. Because
// it's a <datalist> (not a <select>), the field still accepts any text the
// user types even if it doesn't match a suggestion — this just fails
// quietly and leaves the field as free text if the catalog can't load.

async function loadItemOptions() {
  try {
    const options = await apiGet('getItemOptions');
    if (options.error) throw new Error(options.error);
    itemRequestedListEl.innerHTML = '';
    options.forEach(function (val) {
      const o = document.createElement('option');
      o.value = val;
      itemRequestedListEl.appendChild(o);
    });
  } catch (err) {
    // Silent — Item Requested just stays a plain free-text field.
  }
}

// ===================== ADD ITEM =====================

function renderTable() {
  tableBody.innerHTML = '';
  pending.forEach(function (row, idx) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + escapeHtml(row.itemRequested) + '</td>' +
      '<td>' + escapeHtml(row.qty) + '</td>' +
      '<td>' + escapeHtml(row.uom) + '</td>' +
      '<td>' + escapeHtml(row.size || '') + '</td>' +
      '<td><button type="button" class="remove-line" data-idx="' + idx + '">&#10005;</button></td>';
    tableBody.appendChild(tr);
  });
  itemCountEl.textContent = pending.length;
  submitAllBtn.disabled = pending.length === 0;
  tableBody.querySelectorAll('.remove-line').forEach(function (btn) {
    btn.addEventListener('click', function () {
      pending.splice(Number(btn.dataset.idx), 1);
      renderTable();
    });
  });
}

addItemBtn.addEventListener('click', function () {
  const itemRequested = itemRequestedInput.value.trim();
  const qty = itemQtyInput.value;
  const uom = itemUomInput.value.trim();
  const size = itemSizeInput.value.trim();

  if (!itemRequested) { alert('Enter the item requested.'); return; }
  if (!qty || Number(qty) <= 0) { alert('Enter a quantity greater than 0.'); return; }
  if (!uom) { alert('Enter a U.O.M.'); return; }

  pending.push({ itemRequested: itemRequested, qty: qty, uom: uom, size: size });
  renderTable();

  itemRequestedInput.value = '';
  itemQtyInput.value = '';
  itemUomInput.value = '';
  itemSizeInput.value = '';
  itemRequestedInput.focus();
});

// ===================== SUBMIT (ONE MRF# FOR THE WHOLE BATCH) =====================

submitAllBtn.addEventListener('click', async function () {
  if (!pending.length) return;

  const projectName = projectNameInput.value.trim();
  const soNumber = soNumberInput.value.trim();
  const lob = lobSelect.value;
  const date = mrfDateInput.value;
  const requestor = requestorSelect.value;
  const requestedBy = requestedByInput.value.trim();
  const productionDeadline = productionDeadlineInput.value;

  if (!projectName) { alert('Project Name is required.'); return; }
  if (!lob) { alert('Select a LOB.'); return; }
  if (!date) { alert('Date is required.'); return; }
  if (!requestor) { alert('Select a Requestor.'); return; }
  if (!requestedBy) { alert('Requested by (full name) is required.'); return; }
  if (!productionDeadline) { alert('Production Deadline is required.'); return; }

  submitAllBtn.disabled = true;
  msg.className = 'msg';
  msg.classList.remove('hidden');
  msg.innerHTML = '<span class="spinner"></span> Submitting ' + pending.length + ' item(s)...';

  try {
    const payload = {
      projectName: projectName,
      soNumber: soNumber,
      lob: lob,
      date: date,
      requestor: requestor,
      requestedBy: requestedBy,
      procurementDeadline: procurementDeadlineInput.value,
      productionDeadline: productionDeadline,
      items: pending
    };

    const res = await apiPost('submitMrf', payload);
    if (res.error) throw new Error(res.error);

    msg.className = 'msg success';
    msg.innerHTML = 'Submitted as <strong>MRF# ' + escapeHtml(res.mrfNumber) + '</strong> — ' + res.count + ' item(s) saved.';
    if (res.sheetUrl) {
      msg.innerHTML += ' <a href="' + res.sheetUrl + '" target="_blank" rel="noopener" class="sheet-link-inline">View in Smartsheet &#8599;</a>';
    }
    if (res.printSheetWarning) {
      msg.innerHTML += '<br><span class="hint">' + escapeHtml(res.printSheetWarning) + '</span>';
    }

    if (res.mrfPdfBase64) {
      try {
        downloadPdfFromBase64_(res.mrfPdfBase64, res.mrfNumber + '.pdf');
      } catch (dlErr) {
        msg.innerHTML += '<br><span class="hint">(PDF download failed: ' + escapeHtml(dlErr.message || String(dlErr)) + ')</span>';
      }
    } else if (res.mrfPdfWarning) {
      msg.innerHTML += '<br><span class="hint">' + escapeHtml(res.mrfPdfWarning) + '</span>';
    }

    // Reset everything for the next request.
    pending = [];
    renderTable();
    projectNameInput.value = '';
    soNumberInput.value = '';
    lobSelect.value = lobSelect.querySelector('option[value="ACP"]') ? 'ACP' : '';
    mrfDateInput.value = todayIso_();
    requestorSelect.value = '';
    requestedByInput.value = '';
    procurementDeadlineInput.value = '';
    productionDeadlineInput.value = '';
    loadMrfPreview(); // fetch a fresh preview for the next submission
  } catch (err) {
    msg.className = 'msg error';
    msg.textContent = err.message || String(err);
    submitAllBtn.disabled = false; // let them retry without losing the staged items
  }
});

// ===================== INIT =====================

renderTable();
mrfDateInput.value = todayIso_();
loadMrfPreview();
loadLobOptions();
loadRequestorOptions();
loadItemOptions();
