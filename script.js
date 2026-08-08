// PASTE your deployed Apps Script Web App URL here (ends in /exec):
const API_URL = 'https://script.google.com/macros/s/AKfycbw9yEAB-kOOOtp3zxZbNy-UnROPMFSUKw2LIIVaQL7lZIGR9-t8Hiyr3163WsWAukAD6w/exec';
const THEME_KEY = 'mrf_form_theme';

// ===================== PDF FONTS =====================
const FONT_ITEMS = 'helvetica';
const FONT_LABELS = 'helvetica';

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
  const resp = await fetch(url.toString());
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
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, payload: payload })
  });
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

function todayIso_() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
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

async function loadMrfPreview() {
  try {
    const res = await apiGet('getNextMrfPreview');
    if (res.error) { mrfPreviewEl.textContent = 'error'; return; }
    mrfPreviewEl.textContent = res.mrfNumber;
  } catch (err) {
    mrfPreviewEl.textContent = 'error';
  }
}

// ===================== DROPDOWNS =====================

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
  } catch (err) { }
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

// ===================== PRINTABLE MRF PDF (A4 TOP HALF) =====================

function formatDateDisplay_(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return parts[1] + '/' + parts[2] + '/' + parts[0];
}

function buildAndDownloadMrfPdf_(payload, res) {
  const { jsPDF } = window.jspdf;

  // A4 dimensions in points: 595.44 x 841.89
  const pageW = 595.44;   
  const pageH = 841.89;   
  const margin = 0.215 * 72; // 15.48 pt
  
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4'
  });

  const contentW = pageW - (margin * 2);
  const rowH = 16; // Adjusted to fit nicely in top half
  let y = margin;

  // --- 1. MRF# Header ---
  doc.setFont(FONT_LABELS, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('MRF#', pageW - margin - 80, y + 10);
  
  doc.setTextColor(200, 0, 0); // Red Color
  doc.setFontSize(12);
  const mrfDigits = String(res.mrfNumber).replace(/^MRF/i, '');
  doc.text(mrfDigits, pageW - margin - 45, y + 10);
  y += 15;

  // --- 2. Black Title Bar ---
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, y, contentW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text('MATERIAL REQUEST FORM', pageW / 2, y + 14, { align: 'center' });
  y += 20;

  // --- 3. Field Block ---
  const col1X = margin;
  const col1LineX = margin + 70;
  const col2X = pageW / 2 + 10;
  const col2LineX = col2X + 110;
  const lineEnd1 = pageW / 2 - 10;
  const lineEnd2 = pageW - margin;

  function drawField(label, value, x, lineX, endX, curY) {
    doc.setFont(FONT_LABELS, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(label, x, curY + 12);
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(lineX, curY + 13, endX, curY + 13);
    if (value) {
      doc.setFontSize(9);
      doc.text(String(value).toUpperCase(), (lineX + endX) / 2, curY + 11, { align: 'center' });
    }
  }

  const leftFields = [
    ['DATE:', formatDateDisplay_(payload.date)],
    ['DEPARTMENT:', payload.requestor],
    ['PURPOSE:', 'REQ.MATERIALS'],
    ['LOB:', payload.lob]
  ];
  const rightFields = [
    ['PROJECT NAME:', payload.projectName],
    ['SALES ORDER:', payload.soNumber],
    ['PROCUREMENT DEADLINE:', formatDateDisplay_(payload.procurementDeadline)],
    ['PRODUCTION DEADLINE:', formatDateDisplay_(payload.productionDeadline)]
  ];

  for (let i = 0; i < 4; i++) {
    drawField(leftFields[i][0], leftFields[i][1], col1X, col1LineX, lineEnd1, y);
    drawField(rightFields[i][0], rightFields[i][1], col2X, col2LineX, lineEnd2, y);
    y += rowH;
  }
  y += 10; // Spacer

  // --- 4. Material Table ---
  // Column Widths tuned for A4 width
  const colWidths = [45, 50, 75, 215, 30, 30, 40];
  const colX = [margin];
  for (let i = 0; i < colWidths.length; i++) colX.push(colX[i] + colWidths[i]);

  doc.setLineWidth(0.5);
  doc.setDrawColor(0);

  // Red Header Row 1 (Merged)
  doc.setTextColor(200, 0, 0);
  doc.setFontSize(8);
  const span1 = colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
  doc.rect(colX[0], y, span1, 14);
  doc.text('MATERIAL DESCRIPTION', colX[0] + span1/2, y + 10, { align: 'center' });
  const span2 = colWidths[4]
