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
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
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

// Local YYYY-MM-DD (avoids the UTC-shift issue with toISOString for date-only inputs).
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

// ===================== PRINTABLE MRF PDF (currently DISABLED on submit) =====================
// Draws the exact printed "MATERIAL REQUEST FORM" layout. Left in place and
// fully working, but NOT called after submit right now — per request, the
// priority is getting the "MRF Print" Google Sheet template verified first.
// To re-enable: uncomment the buildAndDownloadMrfPdf_(payload, res) call in
// the submit handler below.

function formatDateDisplay_(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return parts[1] + '/' + parts[2] + '/' + parts[0];
}

function buildAndDownloadMrfPdf_(payload, res) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const margin = 10;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;
  let y = margin;

  // ---- MRF# (top right) ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text('MRF#', pageW - margin - 38, y + 5);
  doc.setTextColor(200, 0, 0);
  doc.text(String(res.mrfNumber).replace(/^MRF/i, ''), pageW - margin - 22, y + 5);
  doc.setTextColor(0, 0, 0);
  y += 9;

  // ---- Title bar ----
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, y, contentW, 9, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text('MATERIAL REQUEST FORM', pageW / 2, y + 6.3, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 9 + 3;

  // ---- Two-column field block ----
  const rowH = 8;
  const leftLabelX = margin;
  const leftLineX1 = margin + 30;
  const leftLineX2 = margin + contentW / 2 - 6;
  const rightLabelX = margin + contentW / 2 + 4;
  const rightLineX1 = rightLabelX + 42;
  const rightLineX2 = margin + contentW;

  function drawFieldRow(labelX, lineX1, lineX2, rowY, label, value) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(label, labelX, rowY + 5.5);
    doc.setDrawColor(0);
    doc.setLineWidth(0.25);
    doc.line(lineX1, rowY + 6.2, lineX2, rowY + 6.2);
    if (value) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(String(value), lineX1 + 1, rowY + 5.3);
    }
  }

  const leftFields = [
    ['DATE:', formatDateDisplay_(payload.date)],
    ['DEPARTMENT:', payload.requestor],
    ['PURPOSE:', 'REQ. MATERIAL'],
    ['LOB:', payload.lob]
  ];
  const rightFields = [
    ['PROJECT NAME:', payload.projectName],
    ['SALES ORDER:', payload.soNumber],
    ['PROCUREMENT DEADLINE:', formatDateDisplay_(payload.procurementDeadline)],
    ['PRODUCTION DEADLINE:', formatDateDisplay_(payload.productionDeadline)]
  ];
  for (let i = 0; i < 4; i++) {
    const rowY = y + i * rowH;
    drawFieldRow(leftLabelX, leftLineX1, leftLineX2, rowY, leftFields[i][0], leftFields[i][1]);
    drawFieldRow(rightLabelX, rightLineX1, rightLineX2, rowY, rightFields[i][0], rightFields[i][1]);
  }
  y += 4 * rowH + 3;

  // ---- Item table ----
  // Proportions taken from the original form; scaled to whatever the page's
  // content width actually is, so the table always fits edge-to-edge.
  const colFractions = [20, 20, 30, 110, 25, 25, 33.4]; // Qty, UOM, Size, Item Description, Release, Request, Receiver
  const fractionSum = colFractions.reduce(function (a, b) { return a + b; }, 0);
  const colWidths = colFractions.map(function (f) { return (contentW * f) / fractionSum; });
  const colX = [margin];
  for (let i = 0; i < colWidths.length; i++) colX.push(colX[i] + colWidths[i]);

  const h1 = 7;
  doc.setDrawColor(0);
  doc.setLineWidth(0.25);
  doc.setTextColor(200, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);

  // Row 1: MATERIAL DESCRIPTION / INVENTORY / END USER spans
  const span1W = colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
  const span2W = colWidths[4] + colWidths[5];
  const span3W = colWidths[6];
  doc.rect(colX[0], y, span1W, h1);
  doc.text('MATERIAL DESCRIPTION', colX[0] + span1W / 2, y + 5, { align: 'center' });
  doc.rect(colX[4], y, span2W, h1);
  doc.text('INVENTORY', colX[4] + span2W / 2, y + 5, { align: 'center' });
  doc.rect(colX[6], y, span3W, h1);
  doc.text('END USER', colX[6] + span3W / 2, y + 5, { align: 'center' });
  y += h1;

  // Row 2: column headers
  const headers = ['QTY', 'UOM', 'SIZE', 'ITEM DESCRIPTION', 'RELEASE', 'REQUEST', 'RECEIVER'];
  const h2 = 7;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(7.5);
  headers.forEach(function (h, i) {
    doc.rect(colX[i], y, colWidths[i], h2);
    doc.text(h, colX[i] + colWidths[i] / 2, y + 4.8, { align: 'center' });
  });
  y += h2;

  // Item rows — Release / Request / Receiver stay blank. Always draws a
  // fixed number of ruled rows (matching the printed form's spacing), even
  // if this batch has fewer items than that — the extra rows stay blank
  // rather than shrinking the table down to just the filled rows.
  const MIN_TABLE_ROWS = 12;
  const footerReserve = 42;
  const pageH = doc.internal.pageSize.getHeight();
  const totalRows = Math.max(payload.items.length, MIN_TABLE_ROWS);
  const availableH = pageH - footerReserve - y;
  const itemRowH = Math.max(6, Math.min(12, availableH / totalRows));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (let r = 0; r < totalRows; r++) {
    headers.forEach(function (h, i) { doc.rect(colX[i], y, colWidths[i], itemRowH); });
    const it = payload.items[r];
    if (it) {
      doc.text(String(it.qty), colX[0] + colWidths[0] / 2, y + itemRowH / 2 + 1.2, { align: 'center' });
      doc.text(String(it.uom || ''), colX[1] + colWidths[1] / 2, y + itemRowH / 2 + 1.2, { align: 'center' });
      doc.text(String(it.size || ''), colX[2] + colWidths[2] / 2, y + itemRowH / 2 + 1.2, { align: 'center' });
      doc.text(String(it.itemRequested), colX[3] + 2, y + itemRowH / 2 + 1.2, { align: 'left' });
    }
    y += itemRowH;
  }

  // ---- Footer / signatures ----
  y = pageH - footerReserve + 6;
  const fLeftLabelX = margin;
  const fLeftLineX1 = margin + 30;
  const fLeftLineX2 = margin + contentW * 0.42;
  const fRightLabelX = margin + contentW * 0.55;
  const fRightLineX1 = fRightLabelX + 26;
  const fRightLineX2 = margin + contentW;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text('REQUESTED BY:', fLeftLabelX, y);
  doc.line(fLeftLineX1, y + 0.8, fLeftLineX2, y + 0.8);
  doc.setFont('helvetica', 'bold');
  doc.text(String(payload.requestedBy || ''), fLeftLineX1 + 1, y - 0.8);

  doc.text('CHECKED BY:', fRightLabelX, y);
  doc.line(fRightLineX1, y + 0.8, fRightLineX2, y + 0.8);

  y += 8;
  doc.setFontSize(8);
  doc.setTextColor(200, 0, 0);
  doc.text('SUPERVISOR/ MANAGER', fLeftLabelX, y);
  doc.setTextColor(200, 0, 0);
  doc.text('INVENTORY PERSONNEL', fRightLabelX, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.text('NAME AND SIGNATURES', (fLeftLineX1 + fLeftLineX2) / 2, y, { align: 'center' });
  doc.text('NAME AND SIGNATURES', (fRightLineX1 + fRightLineX2) / 2, y, { align: 'center' });

  y += 10;
  const aLabelX = margin + contentW * 0.34;
  const aLineX1 = aLabelX + 28;
  const aLineX2 = margin + contentW * 0.75;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('APPROVED BY:', aLabelX, y);
  doc.line(aLineX1, y + 0.8, aLineX2, y + 0.8);

  y += 8;
  doc.setFontSize(8);
  doc.setTextColor(200, 0, 0);
  doc.text('OIC SUPERVISOR', aLabelX, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.text('NAME AND SIGNATURES', (aLineX1 + aLineX2) / 2, y, { align: 'center' });

  doc.save(res.mrfNumber + '.pdf');
}

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
    } else {
      msg.innerHTML += '<br><span class="hint">"MRF Print" Google Sheet updated.</span>';
    }

    // PDF auto-download is disabled for now — see buildAndDownloadMrfPdf_
    // above. Uncomment this block to re-enable it once the Google Sheet
    // template is confirmed working.
    // try {
    //   buildAndDownloadMrfPdf_(payload, res);
    // } catch (pdfErr) {
    //   msg.innerHTML += '<br><span class="hint">(PDF download failed: ' + escapeHtml(pdfErr.message || String(pdfErr)) + ')</span>';
    // }

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
