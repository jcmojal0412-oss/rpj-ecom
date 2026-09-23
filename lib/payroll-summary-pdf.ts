// Payroll Summary PDF — one table, one page per ~28 employees: who is being
// paid this period, and how much. This is a disbursement summary, not a
// payslip — it never leaves the server as anything but a PDF attachment.
import PDFDocument from 'pdfkit';
import { COMPANY_NAME, payPeriodText } from './payslip-email';

export interface SummaryRow {
  employee_name_snapshot: string; employee_code_snapshot: string;
  basic_pay: number; ot_pay: number; total_deductions: number; net_pay: number;
}
export interface SummaryPeriod { label: string; from_date: string; to_date: string; pay_date: string | null; schedule: string | null }

const peso = (n: number) => `${n < 0 ? '-' : ''}P${Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null) => {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
};

// Columns as x-offsets from the table's left edge, and each one's width.
const COLS = [
  { key: 'no', label: '#', x: 0, w: 24, align: 'right' as const },
  { key: 'name', label: 'Employee', x: 26, w: 168, align: 'left' as const },
  { key: 'code', label: 'Code', x: 198, w: 58, align: 'left' as const },
  { key: 'basic', label: 'Basic Pay', x: 260, w: 80, align: 'right' as const },
  { key: 'ot', label: 'OT Pay', x: 344, w: 70, align: 'right' as const },
  { key: 'ded', label: 'Deductions', x: 418, w: 80, align: 'right' as const },
  { key: 'net', label: 'Net Pay', x: 502, w: 88, align: 'right' as const },
];
const TABLE_LEFT = 40, ROW_H = 20, HEADER_H = 22;
// The last column's right edge, not a separate guess — a fixed width here
// that drifted from COLS above is exactly what clipped "Net Pay" off the
// dark header band (rendered in white, invisible on the white page) before.
const lastCol = COLS[COLS.length - 1];
const TABLE_WIDTH = lastCol.x + lastCol.w;

export function buildPayrollSummaryPdf(period: SummaryPeriod, rows: SummaryRow[], generatedBy: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageBottom = doc.page.height - doc.page.margins.bottom;
    let y = doc.page.margins.top;

    const drawHeader = () => {
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#16233B').text(COMPANY_NAME, TABLE_LEFT, y);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#16233B').text('Payroll Summary', TABLE_LEFT, y + 20);
      doc.font('Helvetica').fontSize(9.5).fillColor('#4B5563');
      doc.text(`Pay period: ${payPeriodText(period.from_date, period.to_date)}${period.schedule ? ` (Schedule ${period.schedule})` : ''}`, TABLE_LEFT, y + 38);
      doc.text(`Pay date: ${fmtDate(period.pay_date)}`, TABLE_LEFT, y + 52);
      doc.text(`Generated: ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })} by ${generatedBy}`, 330, y + 38);
      doc.text('For payroll disbursement reference. Full per-employee breakdown is available in the system.', 330, y + 52, { width: 232 });
      y += 76;
    };

    const drawTableHeader = () => {
      doc.rect(TABLE_LEFT, y, TABLE_WIDTH, HEADER_H).fill('#16233B');
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF');
      for (const c of COLS) doc.text(c.label, TABLE_LEFT + c.x + 4, y + 6, { width: c.w - 8, align: c.align });
      y += HEADER_H;
    };

    const ensureRoom = (needed: number) => {
      if (y + needed > pageBottom) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
        y = doc.page.margins.top;
        drawTableHeader();
      }
    };

    drawHeader();
    drawTableHeader();

    let totalBasic = 0, totalOt = 0, totalDed = 0, totalNet = 0;
    rows.forEach((r, i) => {
      ensureRoom(ROW_H);
      if (i % 2 === 1) doc.rect(TABLE_LEFT, y, TABLE_WIDTH, ROW_H).fill('#F5F7FA');
      doc.font('Helvetica').fontSize(9).fillColor('#1F2937');
      const cells: Record<string, string> = {
        no: String(i + 1), name: r.employee_name_snapshot, code: r.employee_code_snapshot,
        basic: peso(r.basic_pay), ot: r.ot_pay ? peso(r.ot_pay) : '-', ded: r.total_deductions ? peso(r.total_deductions) : '-', net: peso(r.net_pay),
      };
      for (const c of COLS) doc.text(cells[c.key], TABLE_LEFT + c.x + 4, y + 5, { width: c.w - 8, align: c.align });
      y += ROW_H;
      totalBasic += r.basic_pay; totalOt += r.ot_pay; totalDed += r.total_deductions; totalNet += r.net_pay;
    });

    ensureRoom(ROW_H + 4);
    doc.moveTo(TABLE_LEFT, y + 2).lineTo(TABLE_LEFT + TABLE_WIDTH, y + 2).lineWidth(1).strokeColor('#16233B').stroke();
    y += 6;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#16233B');
    doc.text(`TOTAL (${rows.length} employee${rows.length === 1 ? '' : 's'})`, TABLE_LEFT + COLS[1].x + 4, y + 4, { width: COLS[1].w + COLS[2].w - 8 });
    doc.text(peso(totalBasic), TABLE_LEFT + COLS[3].x + 4, y + 4, { width: COLS[3].w - 8, align: 'right' });
    doc.text(totalOt ? peso(totalOt) : '-', TABLE_LEFT + COLS[4].x + 4, y + 4, { width: COLS[4].w - 8, align: 'right' });
    doc.text(totalDed ? peso(totalDed) : '-', TABLE_LEFT + COLS[5].x + 4, y + 4, { width: COLS[5].w - 8, align: 'right' });
    doc.text(peso(totalNet), TABLE_LEFT + COLS[6].x + 4, y + 4, { width: COLS[6].w - 8, align: 'right' });

    doc.end();
  });
}
