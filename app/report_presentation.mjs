import fs from 'node:fs/promises';

const [inputPath, outputPath] = process.argv.slice(2);
const artifactToolRoot = process.env.SALES_DASHBOARD_ARTIFACT_TOOL_ROOT;
if (!artifactToolRoot) throw new Error('Presentation runtime is not configured.');
const { Presentation, PresentationFile } = await import(`${artifactToolRoot}/dist/artifact_tool.mjs`);
const NAVY = '#08065c';
const BLUE = '#2374ab';
const ORANGE = '#ca6b27';
const GRID = '#d9dee8';
const SOFT = '#f5f7fb';

async function addText(slide, text, position, style = {}) {
  const shape = slide.shapes.add({ geometry: 'textbox', position, fill: 'none', line: { style: 'solid', fill: 'none', width: 0 } });
  shape.text = text;
  shape.text.style = { fontSize: 18, color: '#142451', ...style };
  return shape;
}

function styleTable(table, { headerRows = 1, fontSize = 12, rowHeight = 28 } = {}) {
  table.borders.assign({ style: 'solid', fill: GRID, width: 1 });
  for (let row = 0; row < table.rows.length; row += 1) {
    table.rows[row].height = row === 0 ? rowHeight + 6 : rowHeight;
    const rowRange = table.cells.block({ row, column: 0, rowCount: 1, columnCount: table.columns.length });
    rowRange.textStyle.fontSize = fontSize;
    rowRange.textStyle.bold = row < headerRows;
    rowRange.textStyle.color = row < headerRows ? '#ffffff' : '#142451';
    if (row < headerRows) rowRange.fill = NAVY;
    else if (row % 2 === 0) rowRange.fill = SOFT;
    for (let column = 0; column < table.columns.length; column += 1) {
      const cell = table.getCell(row, column);
      cell.text.style = { fontSize, color: row < headerRows ? '#ffffff' : '#142451', bold: row < headerRows };
    }
  }
}

function addSectionTitle(slide, title, left, top, width) {
  const bar = slide.shapes.add({ geometry: 'roundRect', position: { left, top, width, height: 34 }, fill: NAVY, line: { style: 'solid', fill: NAVY, width: 0 }, borderRadius: 7 });
  bar.text = title;
  bar.text.style = { fontSize: 18, bold: true, color: '#ffffff', alignment: 'center' };
}

function compactText(cell, limit) {
  const text = String(cell ?? '');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function addFixedGrid(slide, values, { left, top, width, height, columnWeights, fontSize = 9 }) {
  const rowHeight = height / values.length;
  const weightTotal = columnWeights.reduce((sum, item) => sum + item, 0);
  const widths = columnWeights.map((item) => (item / weightTotal) * width);
  values.forEach((row, rowIndex) => {
    let cellLeft = left;
    row.forEach((cellValue, columnIndex) => {
      const isHeader = rowIndex === 0;
      const shape = slide.shapes.add({
        geometry: 'rect',
        position: { left: cellLeft, top: top + rowIndex * rowHeight, width: widths[columnIndex], height: rowHeight },
        fill: isHeader ? NAVY : (rowIndex % 2 === 0 ? SOFT : '#ffffff'),
        line: { style: 'solid', fill: GRID, width: 1 },
      });
      shape.text = compactText(cellValue, columnIndex === 1 ? 19 : columnIndex === 2 ? 16 : 12);
      shape.text.style = { fontSize, bold: isHeader, color: isHeader ? '#ffffff' : '#142451', alignment: columnIndex < 3 ? 'left' : 'center' };
      cellLeft += widths[columnIndex];
    });
  });
}

function value(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

async function main() {
  const report = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const demand = report.demand || {};
  const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });

  const bcmi = deck.slides.add();
  bcmi.background.fill = '#ffffff';
  await addText(bcmi, 'BCMI Executive Report', { left: 58, top: 38, width: 720, height: 50 }, { fontSize: 36, bold: true, color: NAVY });
  await addText(bcmi, 'Business Commitment Management', { left: 60, top: 89, width: 500, height: 24 }, { fontSize: 16, color: '#60708c' });
  addSectionTitle(bcmi, 'COMMITMENT & RA', 58, 136, 715);
  const commitment = bcmi.tables.add({
    rows: 5,
    columns: 5,
    left: 58,
    top: 176,
    width: 715,
    height: 182,
    columnWidths: [120, 145, 145, 165, 140],
    values: [
      ['Commit', 'Revenue', 'RA', 'RA Achieved', 'GAP'],
      ['Aug', '—', '—', '—', '—'],
      ['Q3', '—', '—', '—', '—'],
      ['Q4', '—', '—', '—', '—'],
      ['Year', '—', '—', '—', '—'],
    ],
  });
  styleTable(commitment, { rowHeight: 29 });
  addSectionTitle(bcmi, 'KEY HIGHLIGHTS', 812, 136, 408);
  await addText(bcmi, 'Use this space to capture major wins, key risks, and leadership actions for the period.', { left: 832, top: 190, width: 360, height: 82 }, { fontSize: 18, color: '#4f5f78' });
  addSectionTitle(bcmi, 'TOP OPPORTUNITIES', 58, 404, 715);
  const opportunities = bcmi.tables.add({
    rows: 4,
    columns: 4,
    left: 58,
    top: 444,
    width: 715,
    height: 210,
    columnWidths: [58, 230, 285, 142],
    values: [['#', 'Account Name', 'Description', 'Total'], ...Array.from({ length: 3 }, (_, index) => [String(index + 1), index === 0 ? 'JPMC' : '', '', '—'])],
  });
  styleTable(opportunities, { fontSize: 10, rowHeight: 22 });
  addSectionTitle(bcmi, 'WINS', 812, 326, 408);
  const wins = bcmi.tables.add({ rows: 3, columns: 3, left: 812, top: 366, width: 408, height: 98, columnWidths: [180, 150, 78], values: [['Account', 'Description', 'TCV'], ['', '', '—'], ['', '', '—']] });
  styleTable(wins, { fontSize: 8, rowHeight: 18 });
  addSectionTitle(bcmi, 'REVENUE EROSION', 812, 516, 408);
  const erosion = bcmi.tables.add({ rows: 3, columns: 3, left: 812, top: 556, width: 408, height: 98, columnWidths: [180, 150, 78], values: [['Account', 'Description', 'Amount'], ['', '', '—'], ['', '', '—']] });
  styleTable(erosion, { fontSize: 8, rowHeight: 18 });

  const demandSlide = deck.slides.add();
  demandSlide.background.fill = '#ffffff';
  await addText(demandSlide, 'Demand Profile & Top Accounts', { left: 58, top: 38, width: 900, height: 50 }, { fontSize: 36, bold: true, color: NAVY });
  await addText(demandSlide, `Source: ${demand.sourceFilename || 'Saved Demand Creation workbook'}`, { left: 60, top: 89, width: 600, height: 24 }, { fontSize: 16, color: '#60708c' });
  addSectionTitle(demandSlide, 'DEMAND PROFILE', 58, 136, 470);
  const profile = demand.demandProfile || {};
  const profileMonths = profile.months || [];
  const profileQuarters = profile.quarters || [];
  const profileHeaders = ['BU', 'Total', ...profileMonths.map((item) => item.label), ...profileQuarters.map((item) => item.label)];
  const profileValues = [profileHeaders, ...(profile.rows || []).map((row) => [row.name, value(row.total), ...profileMonths.map((item) => value(row.months?.[item.key])), ...profileQuarters.map((item) => value(row.quarters?.[item.key]))])];
  const profileTable = demandSlide.tables.add({ rows: Math.max(2, profileValues.length), columns: profileHeaders.length, left: 58, top: 176, width: 470, height: 115, values: profileValues });
  styleTable(profileTable, { fontSize: 10, rowHeight: 22 });
  addSectionTitle(demandSlide, 'WEEK ON WEEK DEMAND GENERATION', 560, 136, 660);
  const weekly = demand.series || [];
  demandSlide.charts.add('line', {
    position: { left: 590, top: 190, width: 590, height: 160 },
    categories: weekly.map((row) => row.weekLabel),
    series: [
      { name: 'BCM', values: weekly.map((row) => Number(row.BCM || 0)), fill: BLUE },
      { name: 'INS 2', values: weekly.map((row) => Number(row.INS2 || 0)), fill: ORANGE },
    ],
    hasLegend: true,
    yAxis: { majorGridlines: { style: 'solid', fill: GRID, width: 1 } },
  });
  addSectionTitle(demandSlide, 'TOP 10 ACCOUNTS', 58, 394, 1162);
  const accounts = demand.topAccounts || {};
  const months = accounts.months || [];
  const quarters = accounts.quarters || [];
  const accountHeaders = ['S.No', 'Account Name', 'Description', ...months.map((item) => item.label), ...quarters.map((item) => item.label), 'Total'];
  const accountRows = (accounts.rows || []).slice(0, 10).map((row, index) => [String(index + 1), row.account, row.description, ...months.map((item) => value(row.months?.[item.key])), ...quarters.map((item) => value(row.quarters?.[item.key])), value(row.total)]);
  const accountValues = [accountHeaders, ...accountRows];
  addFixedGrid(demandSlide, accountValues, { left: 58, top: 434, width: 1162, height: 230, columnWeights: [0.55, 1.6, 1.45, ...Array.from({ length: accountHeaders.length - 3 }, () => 0.85)], fontSize: 9 });

  const output = await PresentationFile.exportPptx(deck);
  await output.save(outputPath);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
