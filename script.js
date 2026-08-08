function buildAndDownloadMrfPdf_(payload, res) {
  const { jsPDF } = window.jspdf;

  const pageW = 595.44;   // A4 Width
  const pageH = 841.89;   // A4 Height
  const margin = 0.215 * 72; 
  
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4'
  });

  const contentW = pageW - (margin * 2);
  const rowH = 12.0; // Extremely tight spreadsheet-style row height
  let y = margin;

  // --- 1. MRF# Header ---
  doc.setFont(FONT_LABELS, 'bold');
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  doc.text('MRF#', pageW - margin - 50, y + 6);
  
  doc.setTextColor(200, 0, 0); // Red
  doc.setFontSize(9);
  const mrfDigits = String(res.mrfNumber).replace(/^MRF/i, '');
  doc.text(mrfDigits, pageW - margin - 25, y + 6);
  y += 10;

  // --- 2. Black Title Bar (Thinner) ---
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, y, contentW, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text('MATERIAL REQUEST FORM', pageW / 2, y + 10, { align: 'center' });
  y += 14;

  // --- 3. Field Block (Compressed) ---
  const col1X = margin;
  const col1LineX = margin + 50;
  const col2X = pageW / 2 + 15;
  const col2LineX = col2X + 80;
  const lineEnd1 = pageW / 2 - 5;
  const lineEnd2 = pageW - margin;

  function drawField(label, value, x, lineX, endX, curY) {
    doc.setFont(FONT_LABELS, 'bold');
    doc.setFontSize(6);
    doc.setTextColor(0, 0, 0);
    doc.text(label, x, curY + 8);
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(lineX, curY + 9, endX, curY + 9);
    if (value) {
      doc.setFontSize(7.5);
      doc.text(String(value).toUpperCase(), (lineX + endX) / 2, curY + 8, { align: 'center' });
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
  y += 2; // Tiny spacer

  // --- 4. Material Table (Compact) ---
  const colWidths = [30, 35, 55, 229, 25, 25, 45]; 
  const colX = [margin];
  for (let i = 0; i < colWidths.length; i++) colX.push(colX[i] + colWidths[i]);

  doc.setLineWidth(0.5);
  doc.setDrawColor(0);

  // Red Header Row 1 (Merged & Thin)
  doc.setTextColor(200, 0, 0);
  doc.setFontSize(6.5);
  const span1 = colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
  doc.rect(colX[0], y, span1, 10);
  doc.text('MATERIAL DESCRIPTION', colX[0] + span1/2, y + 7, { align: 'center' });
  
  const span2 = colWidths[4] + colWidths[5];
  doc.rect(colX[4], y, span2, 10);
  doc.text('INVENTORY', colX[4] + span2/2, y + 7, { align: 'center' });
  
  const span3 = colWidths[6];
  doc.rect(colX[6], y, span3, 10);
  doc.text('END USER', colX[6] + span3/2, y + 7, { align: 'center' });
  y += 10;

  // Header Row 2
  const headers = ['QUANTITY', 'UOM', 'SIZE', 'ITEM DESCRIPTION', 'RELEASE', 'REQUEST', 'RECEIVER'];
  doc.setTextColor(0, 0, 0);
  headers.forEach((h, i) => {
    doc.rect(colX[i], y, colWidths[i], 11);
    doc.setFontSize(5.5);
    doc.text(h, colX[i] + colWidths[i]/2, y + 8, { align: 'center' });
  });
  y += 11;

  // Item Rows (Fixed 13 rows, tight spacing)
  for (let r = 0; r < 13; r++) {
    headers.forEach((h, i) => doc.rect(colX[i], y, colWidths[i], rowH));
    const it = payload.items[r];
    if (it) {
      doc.setFontSize(7.5);
      doc.text(String(it.qty), colX[0] + colWidths[0]/2, y + 8.5, { align: 'center' });
      doc.text(String(it.uom).toUpperCase(), colX[1] + colWidths[1]/2, y + 8.5, { align: 'center' });
      doc.text(String(it.size || '').toUpperCase(), colX[2] + colWidths[2]/2, y + 8.5, { align: 'center' });
      doc.text(String(it.itemRequested).toUpperCase(), colX[3] + 4, y + 8.5);
    }
    y += rowH;
  }
  y += 6; // Move signatures closer

  // --- 5. Footer / Signatures ---
  const footLLine = margin + 50;
  const footLEnd = margin + 170;
  const footRLine = pageW / 2 + 50;
  const footREnd = pageW - margin;

  doc.setFontSize(6.5);
  doc.setTextColor(0, 0, 0);
  
  // Row 1
  doc.text('REQUESTED BY:', margin, y + 7);
  doc.line(footLLine, y + 8, footLEnd, y + 8);
  if (payload.requestedBy) {
    doc.text(payload.requestedBy.toUpperCase(), (footLLine + footLEnd)/2, y + 7, { align: 'center' });
  }

  doc.text('CHECKED BY:', pageW / 2 + 10, y + 7);
  doc.line(footRLine, y + 8, footREnd, y + 8);
  y += 9;

  // Row 2 sub-labels
  doc.setTextColor(200, 0, 0);
  doc.setFontSize(5.5);
  doc.text('SUPERVISOR/ MANAGER', margin, y + 5);
  doc.text('INVENTORY PERSONNEL', pageW / 2 + 10, y + 5);
  doc.setTextColor(0,0,0);
  doc.text('NAME AND SIGNATURES', (footLLine + footLEnd)/2, y + 5, { align: 'center' });
  doc.text('NAME AND SIGNATURES', (footRLine + footREnd)/2, y + 5, { align: 'center' });
  y += 12;

  // Row 3: Approved By
  const appLine = pageW / 2 - 20;
  const appEnd = appLine + 120;
  
  doc.setFontSize(6.5);
  doc.text('APPROVED BY:', pageW / 2 - 80, y + 7);
  doc.line(appLine, y + 8, appEnd, y + 8);
  y += 9;

  // Row 4 sub-label
  doc.setTextColor(200, 0, 0);
  doc.setFontSize(5.5);
  doc.text('OIC SUPERVISOR', pageW / 2 - 80, y + 5);
  doc.setTextColor(0,0,0);
  doc.text('NAME AND SIGNATURES', (appLine + appEnd)/2, y + 5, { align: 'center' });

  doc.save(res.mrfNumber + '.pdf');
}
