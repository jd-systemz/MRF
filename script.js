function buildAndDownloadMrfPdf_(payload, res) {
  const { jsPDF } = window.jspdf;

  // Standard A4 Dimensions in points
  const pageW = 595.44;   
  const pageH = 841.89;   
  const margin = 0.215 * 72; // 15.48 pt
  
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4'
  });

  const contentW = pageW - (margin * 2);
  const rowH = 13.5; // Tighter row height to match the 2nd picture
  let y = margin;

  // --- 1. MRF# Header ---
  doc.setFont(FONT_LABELS, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text('MRF#', pageW - margin - 50, y + 8);
  
  doc.setTextColor(200, 0, 0); // Red
  doc.setFontSize(10);
  const mrfDigits = String(res.mrfNumber).replace(/^MRF/i, '');
  doc.text(mrfDigits, pageW - margin - 25, y + 8);
  y += 12;

  // --- 2. Black Title Bar ---
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, y, contentW, 16, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.text('MATERIAL REQUEST FORM', pageW / 2, y + 11, { align: 'center' });
  y += 16;

  // --- 3. Field Block ---
  const col1X = margin;
  const col1LineX = margin + 50;
  const col2X = pageW / 2 + 20;
  const col2LineX = col2X + 80;
  const lineEnd1 = pageW / 2 - 5;
  const lineEnd2 = pageW - margin;

  function drawField(label, value, x, lineX, endX, curY) {
    doc.setFont(FONT_LABELS, 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(0, 0, 0);
    doc.text(label, x, curY + 9);
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(lineX, curY + 10, endX, curY + 10);
    if (value) {
      doc.setFontSize(8);
      doc.text(String(value).toUpperCase(), (lineX + endX) / 2, curY + 8.5, { align: 'center' });
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
  y += 4; // Tiny spacer before table

  // --- 4. Material Table ---
  // Ratios: Qty(35), Uom(40), Size(60), Description(220), Rel(30), Req(30), Rec(30)
  const colWidths = [35, 40, 60, 219, 30, 30, 50]; 
  const colX = [margin];
  for (let i = 0; i < colWidths.length; i++) colX.push(colX[i] + colWidths[i]);

  doc.setLineWidth(0.5);
  doc.setDrawColor(0);

  // Red Header Row 1 (Merged)
  doc.setTextColor(200, 0, 0);
  doc.setFontSize(7);
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
    doc.rect(colX[i], y, colWidths[i], 12);
    doc.setFontSize(6);
    doc.text(h, colX[i] + colWidths[i]/2, y + 8, { align: 'center' });
  });
  y += 12;

  // Item Rows (Fixed 13 rows)
  for (let r = 0; r < 13; r++) {
    headers.forEach((h, i) => doc.rect(colX[i], y, colWidths[i], rowH));
    const it = payload.items[r];
    if (it) {
      doc.setFontSize(8);
      doc.text(String(it.qty), colX[0] + colWidths[0]/2, y + 9, { align: 'center' });
      doc.text(String(it.uom).toUpperCase(), colX[1] + colWidths[1]/2, y + 9, { align: 'center' });
      doc.text(String(it.size || '').toUpperCase(), colX[2] + colWidths[2]/2, y + 9, { align: 'center' });
      doc.text(String(it.itemRequested).toUpperCase(), colX[3] + 4, y + 9);
    }
    y += rowH;
  }
  y += 8;

  // --- 5. Footer / Signatures ---
  const footL = margin;
  const footLLine = margin + 55;
  const footLEnd = margin + 175;

  const footR = pageW / 2 + 50;
  const footRLine = footR + 50;
  const footREnd = pageW - margin;

  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  
  // Row 1
  doc.text('REQUESTED BY:', footL, y + 8);
  doc.line(footLLine, y + 9, footLEnd, y + 9);
  if (payload.requestedBy) {
    doc.text(payload.requestedBy.toUpperCase(), (footLLine + footLEnd)/2, y + 7.5, { align: 'center' });
  }

  doc.text('CHECKED BY:', footR, y + 8);
  doc.line(footRLine, y + 9, footREnd, y + 9);
  y += 10;

  // Row 2 sub-labels
  doc.setTextColor(200, 0, 0);
  doc.setFontSize(6);
  doc.text('SUPERVISOR/ MANAGER', footL, y + 6);
  doc.text('INVENTORY PERSONNEL', footR, y + 6);
  doc.setTextColor(0,0,0);
  doc.text('NAME AND SIGNATURES', (footLLine + footLEnd)/2, y + 6, { align: 'center' });
  doc.text('NAME AND SIGNATURES', (footRLine + footREnd)/2, y + 6, { align: 'center' });
  y += 16;

  // Row 3: Approved By
  const appL = pageW / 2 - 60;
  const appLine = appL + 60;
  const appEnd = appLine + 150;
  
  doc.setFontSize(7);
  doc.text('APPROVED BY:', appL, y + 8);
  doc.line(appLine, y + 9, appEnd, y + 9);
  y += 10;

  // Row 4 sub-label
  doc.setTextColor(200, 0, 0);
  doc.setFontSize(6);
  doc.text('OIC SUPERVISOR', appL, y + 6);
  doc.setTextColor(0,0,0);
  doc.text('NAME AND SIGNATURES', (appLine + appEnd)/2, y + 6, { align: 'center' });

  doc.save(res.mrfNumber + '.pdf');
}
