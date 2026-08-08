// PASTE your deployed Apps Script Web App URL here (ends in /exec):
const API_URL = 'https://script.google.com/macros/s/AKfycbw9yEAB-kOOOtp3zxZbNy-UnROPMFSUKw2LIIVaQL7lZIGR9-t8Hiyr3163WsWAukAD6w/exec';
const THEME_KEY = 'mrf_form_theme';

// ===================== PDF FONTS =====================
// jsPDF only ships 3 built-in font families: Helvetica, Times, Courier.
// Arial and Tahoma aren't available without embedding licensed .ttf files,
// so both stand-ins below resolve to Helvetica — it's metrically identical
// to Arial (same letter widths) and is the closest available match to
// Tahoma too, since no other built-in sans-serif exists.
//   FONT_ITEMS  -> stands in for Arial  (item description table)
//   FONT_LABELS -> stands in for Tahoma (date/department/deadlines/signatories)
// If real Arial/Tahoma .ttf files become available, embed them with
// doc.addFileToVFS()/doc.addFont() and just repoint these two constants —
// nothing else in buildAndDownloadMrfPdf_ needs to change.
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

// ===================== PRINTABLE MRF PDF =====================
// Draws the exact printed "MATERIAL REQUEST FORM" layout (title bar, the
// two-column field block, the material/inventory/end-user table, and the
// signature footer) and auto-downloads it right after a successful submit.
// Release / Request / Receiver columns and Checked By / Approved By lines
// are intentionally left blank — they're filled in by hand later. Purpose
// is always "Req. Materials" since this form only ever requests materials.
//
// Font usage matches the printed form's intent: FONT_ITEMS (Arial
// stand-in) for the item description table, FONT_LABELS (Tahoma stand-in)
// for everything else — date/department/deadlines/labels and the
// signature block. Both currently resolve to Helvetica (see top of file).

function formatDateDisplay_(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return parts[1] + '/' + parts[2] + '/' + parts[0];
}

// ---- Font auto-fit ----
// Mirrors Google Sheets' own "shrink to fit" behavior: text is drawn as
// large as possible (up to MAX_FONT_SIZE, matching the largest usable size
// in Sheets) and only steps down from there if it's too wide for the cell
// it sits in — never grows past the max, never shrinks below MIN_FONT_SIZE.
const MAX_FONT_SIZE = 25; // pt
const MIN_FONT_SIZE = 6;  // pt

function fitFontSize_(doc, text, font, style, maxWidth, maxSize, minSize) {
  const cap = Math.min(maxSize || MAX_FONT_SIZE, MAX_FONT_SIZE);
  const floor = minSize || MIN_FONT_SIZE;
  let size = cap;
  doc.setFont(font, style);
  doc.setFontSize(size);
  const str = String(text == null ? '' : text);
  if (!str) return size;
  while (size > floor && doc.getTextWidth(str) > maxWidth) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  return size;
}

function buildAndDownloadMrfPdf_(payload, res) {
  const { jsPDF } = window.jspdf;

  // ---- Row grid ----
  // Every row is exactly 55px tall, matching the source Google Sheet's row
  // height exactly. The title bar and the MATERIAL DESCRIPTION / INVENTORY
  // / END USER header are each 2 rows merged (110px), same as the sheet.
  const ROW_H = 55;
  const HEADER_H = ROW_H * 2; // 110px
  const MIN_TABLE_ROWS = 13;  // matches the sheet's item rows (13–25)
  const FIELD_ROWS = 4;       // date/department/purpose/lob + the 4 right-side fields
  const FOOTER_ROWS = 4;      // requested/checked, supervisor labels, approved by, oic supervisor

  const margin = 20;
  const contentH =
    ROW_H +                    // MRF# line
    HEADER_H +                 // title bar
    ROW_H * FIELD_ROWS +       // field block
    ROW_H +                    // blank spacer row
    HEADER_H +                 // MATERIAL DESCRIPTION / INVENTORY / END USER
    ROW_H +                    // QUANTITY / UOM / SIZE / ... headers
    ROW_H * MIN_TABLE_ROWS +   // item rows
    ROW_H * FOOTER_ROWS;       // signature block

  const pageW = 850;
  const pageH = margin * 2 + contentH;
  // Page is sized exactly to the content grid above (unit: px, at the same
  // 55px-per-row scale as the sheet) rather than a fixed A4/Letter sheet —
  // that's what keeps every row exactly 55px without stretching or cropping.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [pageW, pageH] });
  const contentW = pageW - margin * 2;
  let y = margin;

  // ---- MRF# line ----
  doc.setTextColor(0, 0, 0);
  fitFontSize_(doc, 'MRF#', FONT_LABELS, 'bold', 90, 18);
  doc.text('MRF#', pageW - margin - 170, y + ROW_H / 2 + 6);
  doc.setTextColor(200, 0, 0);
  const mrfDigits = String(res.mrfNumber).replace(/^MRF/i, '');
  fitFontSize_(doc, mrfDigits, FONT_LABELS, 'bold', 110, 20);
  doc.text(mrfDigits, pageW - margin - 100, y + ROW_H / 2 + 6);
  doc.setTextColor(0, 0, 0);
  y += ROW_H;

  // ---- Title bar (2 rows merged) ----
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, y, contentW, HEADER_H, 'F');
  doc.setTextColor(255, 255, 255);
  fitFontSize_(doc, 'MATERIAL REQUEST FORM', FONT_LABELS, 'bold', contentW - 60, MAX_FONT_SIZE);
  doc.text('MATERIAL REQUEST FORM', pageW / 2, y + HEADER_H / 2 + 8, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += HEADER_H;

  // ---- Field rows ----
  const leftLabelX = margin;
  const leftLineX1 = margin + 110;
  const leftLineX2 = margin + contentW / 2 - 20;
  const rightLabelX = margin + contentW / 2 + 15;
  const rightLineX1 = rightLabelX + 160;
  const rightLineX2 = margin + contentW;

  function drawFieldRow(labelX, lineX1, lineX2, rowY, label, value) {
    doc.setFont(FONT_LABELS, 'bold');
    doc.setFontSize(13);
    doc.setTextColor(0, 0, 0);
    doc.text(label, labelX, rowY + ROW_H - 18);
    doc.setDrawColor(0);
    doc.setLineWidth(1);
    doc.line(lineX1, rowY + ROW_H - 16, lineX2, rowY + ROW_H - 16);
    if (value) {
      fitFontSize_(doc, String(value), FONT_LABELS, 'bold', lineX2 - lineX1 - 8, MAX_FONT_SIZE, 9);
      doc.text(String(value), (lineX1 + lineX2) / 2, rowY + ROW_H - 22, { align: 'center' });
    }
  }

  const leftFields = [
    ['DATE:', formatDateDisplay_(payload.date)],
    ['DEPARTMENT', payload.requestor],
    ['PURPOSE:', 'Req. Materials'],
    ['LOB:', payload.lob]
  ];
  const rightFields = [
    ['PROJECT NAME:', payload.projectName],
    ['SALES ORDER:', payload.soNumber],
    ['PROCUREMENT DEADLINE', formatDateDisplay_(payload.procurementDeadline)],
    ['PRODUCTION DEADLINE:', formatDateDisplay_(payload.productionDeadline)]
  ];
  for (let i = 0; i < FIELD_ROWS; i++) {
    const rowY = y + i * ROW_H;
    drawFieldRow(leftLabelX, leftLineX1, leftLineX2, rowY, leftFields[i][0], leftFields[i][1]);
    drawFieldRow(rightLabelX, rightLineX1, rightLineX2, rowY, rightFields[i][0], rightFields[i][1]);
  }
  y += ROW_H * FIELD_ROWS;
  y += ROW_H; // blank spacer row

  // ---- Item table ----
  // Column proportions taken from the original form, scaled to the page's
  // content width so the table always fits edge-to-edge.
  const colFractions = [20, 20, 30, 110, 25, 25, 33.4]; // Qty, UOM, Size, Item Description, Release, Request, Receiver
  const fractionSum = colFractions.reduce(function (a, b) { return a + b; }, 0);
  const colWidths = colFractions.map(function (f) { return (contentW * f) / fractionSum; });
  const colX = [margin];
  for (let i = 0; i < colWidths.length; i++) colX.push(colX[i] + colWidths[i]);

  doc.setDrawColor(0);
  doc.setLineWidth(1);

  // Span header (2 rows merged): MATERIAL DESCRIPTION / INVENTORY / END USER
  const span1W = colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
  const span2W = colWidths[4] + colWidths[5];
  const span3W = colWidths[6];
  doc.setTextColor(200, 0, 0);
  doc.rect(colX[0], y, span1W, HEADER_H);
  fitFontSize_(doc, 'MATERIAL DESCRIPTION', FONT_LABELS, 'bold', span1W - 20, MAX_FONT_SIZE);
  doc.text('MATERIAL DESCRIPTION', colX[0] + span1W / 2, y + HEADER_H / 2 + 6, { align: 'center' });
  doc.rect(colX[4], y, span2W, HEADER_H);
  fitFontSize_(doc, 'INVENTORY', FONT_LABELS, 'bold', span2W - 12, MAX_FONT_SIZE);
  doc.text('INVENTORY', colX[4] + span2W / 2, y + HEADER_H / 2 + 6, { align: 'center' });
  doc.rect(colX[6], y, span3W, HEADER_H);
  fitFontSize_(doc, 'END USER', FONT_LABELS, 'bold', span3W - 12, MAX_FONT_SIZE);
  doc.text('END USER', colX[6] + span3W / 2, y + HEADER_H / 2 + 6, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += HEADER_H;

  // Column header row
  const headers = ['QUANTITY', 'UOM', 'SIZE', 'ITEM DESCRIPTION', 'RELEASE', 'REQUEST', 'RECEIVER'];
  headers.forEach(function (h, i) {
    doc.rect(colX[i], y, colWidths[i], ROW_H);
    fitFontSize_(doc, h, FONT_LABELS, 'bold', colWidths[i] - 8, MAX_FONT_SIZE);
    doc.text(h, colX[i] + colWidths[i] / 2, y + ROW_H / 2 + 4, { align: 'center' });
  });
  y += ROW_H;

  // Item rows — Release / Request / Receiver stay blank. Always draws
  // MIN_TABLE_ROWS ruled rows (matching the sheet's rows 13–25), even if
  // this batch has fewer items — the extra rows stay blank rather than
  // shrinking the table. Item description text uses FONT_ITEMS (Arial
  // stand-in); each cell's font size auto-fits its column width.
  for (let r = 0; r < MIN_TABLE_ROWS; r++) {
    headers.forEach(function (h, i) { doc.rect(colX[i], y, colWidths[i], ROW_H); });
    const it = payload.items[r];
    if (it) {
      fitFontSize_(doc, String(it.qty), FONT_ITEMS, 'normal', colWidths[0] - 8, MAX_FONT_SIZE);
      doc.text(String(it.qty), colX[0] + colWidths[0] / 2, y + ROW_H / 2 + 4, { align: 'center' });
      fitFontSize_(doc, String(it.uom || ''), FONT_ITEMS, 'normal', colWidths[1] - 8, MAX_FONT_SIZE);
      doc.text(String(it.uom || ''), colX[1] + colWidths[1] / 2, y + ROW_H / 2 + 4, { align: 'center' });
      fitFontSize_(doc, String(it.size || ''), FONT_ITEMS, 'normal', colWidths[2] - 8, MAX_FONT_SIZE);
      doc.text(String(it.size || ''), colX[2] + colWidths[2] / 2, y + ROW_H / 2 + 4, { align: 'center' });
      fitFontSize_(doc, String(it.itemRequested), FONT_ITEMS, 'normal', colWidths[3] - 12, MAX_FONT_SIZE);
      doc.text(String(it.itemRequested), colX[3] + 6, y + ROW_H / 2 + 4, { align: 'left' });
    }
    y += ROW_H;
  }

  // ---- Footer / signatures (4 rows, 55px each) ----
  const fLeftLabelX = margin;
  const fLeftLineX1 = margin + 110;
  const fLeftLineX2 = margin + contentW * 0.42;
  const fRightLabelX = margin + contentW * 0.55;
  const fRightLineX1 = fRightLabelX + 110;
  const fRightLineX2 = margin + contentW;

  // Row: REQUESTED BY / CHECKED BY
  doc.setFont(FONT_LABELS, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text('REQUESTED BY:', fLeftLabelX, y + ROW_H - 18);
  doc.line(fLeftLineX1, y + ROW_H - 16, fLeftLineX2, y + ROW_H - 16);
  if (payload.requestedBy) {
    fitFontSize_(doc, payload.requestedBy, FONT_LABELS, 'bold', fLeftLineX2 - fLeftLineX1 - 8, MAX_FONT_SIZE, 9);
    doc.text(String(payload.requestedBy), (fLeftLineX1 + fLeftLineX2) / 2, y + ROW_H - 22, { align: 'center' });
  }
  doc.setFont(FONT_LABELS, 'bold');
  doc.setFontSize(13);
  doc.text('CHECKED BY:', fRightLabelX, y + ROW_H - 18);
  doc.line(fRightLineX1, y + ROW_H - 16, fRightLineX2, y + ROW_H - 16);
  y += ROW_H;

  // Row: SUPERVISOR/ MANAGER ... INVENTORY PERSONNEL sub-labels
  doc.setFont(FONT_LABELS, 'normal');
  doc.setFontSize(11);
  doc.setTextColor(200, 0, 0);
  doc.text('SUPERVISOR/ MANAGER', fLeftLabelX, y + 18);
  doc.text('INVENTORY PERSONNEL', fRightLabelX, y + 18);
  doc.setTextColor(0, 0, 0);
  doc.text('NAME AND SIGNATURES', (fLeftLineX1 + fLeftLineX2) / 2, y + 18, { align: 'center' });
  doc.text('NAME AND SIGNATURES', (fRightLineX1 + fRightLineX2) / 2, y + 18, { align: 'center' });
  y += ROW_H;

  // Row: APPROVED BY
  const aLabelX = margin + contentW * 0.34;
  const aLineX1 = aLabelX + 100;
  const aLineX2 = margin + contentW * 0.75;
  doc.setFont(FONT_LABELS, 'bold');
  doc.setFontSize(13);
  doc.text('APPROVED BY:', aLabelX, y + ROW_H - 18);
  doc.line(aLineX1, y + ROW_H - 16, aLineX2, y + ROW_H - 16);
  y += ROW_H;

  // Row: OIC SUPERVISOR sub-label
  doc.setFont(FONT_LABELS, 'normal');
  doc.setFontSize(11);
  doc.setTextColor(200, 0, 0);
  doc.text('OIC SUPERVISOR', aLabelX, y + 18);
  doc.setTextColor(0, 0, 0);
  doc.text('NAME AND SIGNATURES', (aLineX1 + aLineX2) / 2, y + 18, { align: 'center' });
  y += ROW_H;

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

    try {
      buildAndDownloadMrfPdf_(payload, res);
    } catch (pdfErr) {
      msg.innerHTML += '<br><span class="hint">(PDF download failed: ' + escapeHtml(pdfErr.message || String(pdfErr)) + ')</span>';
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
