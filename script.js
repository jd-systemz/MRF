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

// ===================== PRINTABLE MRF PDF (A5 PORTRAIT) =====================

function formatDateDisplay_(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return parts[1] + '/' + parts[2] + '/' + parts[0];
}

function buildAndDownloadMrfPdf_(payload, res) {
  const { jsPDF } = window.jspdf;

  // Dimensions: Half A4 (A5) is 5.83 x 8.27 inches
  // 1 inch = 72 points
  const margin = 0.215 * 72; 
  const pageW = 5.83 * 72;   
  const pageH = 8.27 * 72;   
  
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: [pageW, pageH]
  });

  const contentW = pageW - (margin * 2);
  const rowH = 14.5; 
  let y = margin;

  // --- 1. MRF# Header ---
  doc.setFont(FONT_LABELS, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text('MRF#', pageW - margin - 55, y + 10);
  
  doc.setTextColor(200, 0, 0); // Red Color
  doc.setFontSize(11);
  const mrfDigits = String(res.mrfNumber).replace(/^MRF/i, '');
  doc.text(mrfDigits, pageW - margin - 30, y + 10);
  y += 15;

  // --- 2. Black Title Bar ---
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, y, contentW, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.text('MATERIAL REQUEST FORM', pageW / 2, y + 12, { align: 'center' });
  y += 18;

  // --- 3. Field Block ---
  const col1X = margin;
  const col1LineX = margin + 55;
  const col2X = pageW / 2 + 10;
  const col2LineX = col2X + 75;
  const lineEnd1 = pageW / 2 - 5;
  const lineEnd2 = pageW - margin;

  function drawField(label, value, x, lineX, endX, curY) {
    doc.setFont(FONT_LABELS, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(0, 0, 0);
    doc.text(label, x, curY + 10);
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(lineX, curY + 11, endX, curY + 11);
    if (value) {
      doc.setFontSize(8);
      doc.text(String(value).toUpperCase(), (lineX + endX) / 2, curY + 9, { align: 'center' });
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
  y += 5;

  // --- 4. Material Table ---
  const colWidths = [30, 35, 55, 148, 30, 30, 40];
  const colX = [margin];
  for (let i = 0; i < colWidths.length; i++) colX.push(colX[i] + colWidths[i]);

  doc.setLineWidth(0.5);
  doc.setDrawColor(0);

  // Red Header Row 1 (Merged)
  doc.setTextColor(200, 0, 0);
  doc.setFontSize(7);
  const span1 = colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
  doc.rect(colX[0], y, span1, 12);
  doc.text('MATERIAL DESCRIPTION', colX[0] + span1/2, y + 8, { align: 'center' });
  const span2 = colWidths[4] + colWidths[5];
  doc.rect(colX[4], y, span2, 12);
  doc.text('INVENTORY', colX[4] + span2/2, y + 8, { align: 'center' });
  const span3 = colWidths[6];
  doc.rect(colX[6], y, span3, 12);
  doc.text('END USER', colX[6] + span3/2, y + 8, { align: 'center' });
  y += 12;

  // Header Row 2
  const headers = ['QUANTITY', 'UOM', 'SIZE', 'ITEM DESCRIPTION', 'RELEASE', 'REQUEST', 'RECEIVER'];
  doc.setTextColor(0, 0, 0);
  headers.forEach((h, i) => {
    doc.rect(colX[i], y, colWidths[i], 12);
    doc.setFontSize(6);
    doc.text(h, colX[i] + colWidths[i]/2, y + 8, { align: 'center' });
  });
  y += 12;

  // Item Rows (Forced to 15 rows to fill the page properly)
  for (let r = 0; r < 15; r++) {
    headers.forEach((h, i) => doc.rect(colX[i], y, colWidths[i], rowH));
    const it = payload.items[r];
    if (it) {
      doc.setFontSize(7);
      doc.text(String(it.qty), colX[0] + colWidths[0]/2, y + 10, { align: 'center' });
      doc.text(String(it.uom), colX[1] + colWidths[1]/2, y + 10, { align: 'center' });
      doc.text(String(it.size || ''), colX[2] + colWidths[2]/2, y + 10, { align: 'center' });
      doc.text(String(it.itemRequested).toUpperCase(), colX[3] + 4, y + 10);
    }
    y += rowH;
  }
  y += 10;

  // --- 5. Footer / Signatures ---
  const footerCol1 = margin;
  const footerCol1Line = margin + 65;
  const footerCol1End = margin + 170;
  const footerCol2 = pageW / 2 + 30;
  const footerCol2Line = footerCol2 + 55;
  const footerCol2End = pageW - margin;

  doc.setFontSize(7);
  doc.text('REQUESTED BY:', footerCol1, y + 10);
  doc.line(footerCol1Line, y + 11, footerCol1End, y + 11);
  if (payload.requestedBy) {
     doc.text(payload.requestedBy.toUpperCase(), (footerCol1Line + footerCol1End)/2, y + 9, { align: 'center' });
  }

  doc.text('CHECKED BY:', footerCol2, y + 10);
  doc.line(footerCol2Line, y + 11, footerCol2End, y + 11);
  y += 12;

  doc.setTextColor(200, 0, 0); // Red sub-labels
  doc.setFontSize(6);
  doc.text('SUPERVISOR/ MANAGER', footerCol1, y + 6);
  doc.text('INVENTORY PERSONNEL', footerCol2, y + 6);
  doc.setTextColor(0,0,0);
  doc.text('NAME AND SIGNATURES', (footerCol1Line + footerCol1End)/2, y + 6, { align: 'center' });
  doc.text('NAME AND SIGNATURES', (footerCol2Line + footerCol2End)/2, y + 6, { align: 'center' });
  y += 18;

  const midLineS = pageW / 2 - 50;
  const midLineE = pageW / 2 + 100;
  doc.setFontSize(7);
  doc.text('APPROVED BY:', midLineS - 55, y + 10);
  doc.line(midLineS, y + 11, midLineE, y + 11);
  y += 12;

  doc.setTextColor(200, 0, 0);
  doc.setFontSize(6);
  doc.text('OIC SUPERVISOR', midLineS - 55, y + 6);
  doc.setTextColor(0,0,0);
  doc.text('NAME AND SIGNATURES', (midLineS + midLineE)/2, y + 6, { align: 'center' });

  doc.save(res.mrfNumber + '.pdf');
}

// ===================== SUBMIT BATCH =====================

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

    try {
      buildAndDownloadMrfPdf_(payload, res);
    } catch (pdfErr) {
      msg.innerHTML += '<br><span class="hint">(PDF download failed: ' + escapeHtml(pdfErr.message || String(pdfErr)) + ')</span>';
    }

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
    loadMrfPreview();
  } catch (err) {
    msg.className = 'msg error';
    msg.textContent = err.message || String(err);
    submitAllBtn.disabled = false;
  }
});

// ===================== INIT =====================

renderTable();
mrfDateInput.value = todayIso_();
loadMrfPreview();
loadLobOptions();
loadRequestorOptions();
loadItemOptions();
