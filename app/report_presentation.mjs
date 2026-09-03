import fs from 'node:fs/promises';

const [inputPath, outputPath] = process.argv.slice(2);
const artifactToolRoot = process.env.SALES_DASHBOARD_ARTIFACT_TOOL_ROOT;
if (!artifactToolRoot) throw new Error('Presentation runtime is not configured.');
const { Presentation } = await import(`${artifactToolRoot}/dist/artifact_tool.mjs`);
const NAVY = '#08065c';
const BLUE = '#2374ab';
const ORANGE = '#ca6b27';
const GRID = '#d9dee8';
const SOFT = '#f5f7fb';
const COMPOSITION_COLORS = ['#2f78c6', '#91bde9', '#00869b'];

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

function fittedFontSize(text, baseSize, cellWidth, cellHeight, minimum = 7) {
  const value = String(text ?? '');
  if (!value) return baseSize;
  const capacity = Math.max(1, (cellWidth / (baseSize * 0.56)) * (cellHeight / (baseSize * 1.25)));
  if (value.length <= capacity) return baseSize;
  return Math.max(minimum, Math.floor(baseSize * Math.sqrt(capacity / value.length)));
}

function addFixedGrid(slide, values, { left, top, width, height, columnWeights, fontSize = 10, minimumFontSize = 7, leftAlignedColumns = [0, 1, 2] }) {
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
      const text = String(cellValue ?? '');
      shape.text = text;
      shape.text.style = {
        fontSize: fittedFontSize(text, fontSize, widths[columnIndex] - 8, rowHeight - 5, minimumFontSize),
        bold: isHeader,
        color: isHeader ? '#ffffff' : '#142451',
        alignment: leftAlignedColumns.includes(columnIndex) ? 'left' : 'center',
      };
      cellLeft += widths[columnIndex];
    });
  });
}

function value(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function moneyMillions(value) {
  return `$${(Number(value || 0) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
}

function moneyForecast(value) {
  return `$${(Number(value || 0) / 1_000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
}

async function main() {
  const report = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const demand = report.demand || {};
  const bcmiData = report.bcmi || {};
  const revenue = bcmiData.revenue?.metrics || {};
  const ra = bcmiData.ra?.metrics || {};
  const opportunitiesByPeriod = bcmiData.opportunities?.periods || {};
  const winsData = bcmiData.wins || {};
  const erosionData = bcmiData.erosion || {};
  const quality = report.quality || {};
  const deck = Presentation.create({ slideSize: { width: 1920, height: 1080 } });

  const bcmi = deck.slides.add();
  bcmi.background.fill = '#ffffff';
  await addText(bcmi, 'BCMI', { left: 60, top: 24, width: 900, height: 48 }, { fontSize: 42, bold: true, color: NAVY });
  await addText(bcmi, 'Business Commitment Management · BCMI - Orig', { left: 62, top: 72, width: 900, height: 24 }, { fontSize: 16, color: '#60708c' });
  addSectionTitle(bcmi, 'COMMITMENT & RA', 60, 112, 980);
  addFixedGrid(bcmi, [
    ['Commit', 'Revenue', 'RA', 'RA Achieved', 'GAP'],
    ['Aug', moneyForecast(revenue.aug), moneyForecast(ra.aug), '—', '—'],
    ['Q3', moneyForecast(revenue.q3), moneyForecast(ra.q3), '—', '—'],
    ['Q4', moneyForecast(revenue.q4), moneyForecast(ra.q4), '—', '—'],
    ['Year', moneyForecast(revenue.year), moneyForecast(ra.year), '—', '—'],
  ], { left: 60, top: 150, width: 980, height: 170, columnWeights: [1.05, 1.25, 1.25, 1.35, 1.1], fontSize: 13, leftAlignedColumns: [0] });
  addSectionTitle(bcmi, 'KEY HIGHLIGHTS', 1060, 112, 800);
  await addText(bcmi, 'Current BCM and Insurance 2 forecast, RA, pipeline wins, top opportunities, and revenue erosion.', { left: 1080, top: 172, width: 760, height: 90 }, { fontSize: 19, color: '#4f5f78' });
  addSectionTitle(bcmi, 'TOP 10 OPPORTUNITIES BY TCV', 60, 344, 1800);
  const opportunityPeriods = [
    ['AUG', opportunitiesByPeriod.aug || {}],
    ['Q3', opportunitiesByPeriod.q3 || {}],
    ['Q4', opportunitiesByPeriod.q4 || {}],
  ];
  opportunityPeriods.forEach(([periodLabel, periodData], panelIndex) => {
    const panelLeft = 60 + panelIndex * 610;
    addFixedGrid(bcmi, [
      [periodLabel, 'GAP', 'Total Opportunity Size'],
      ['', '—', moneyMillions(periodData.totalTcv)],
    ], { left: panelLeft, top: 382, width: 590, height: 58, columnWeights: [0.8, 0.8, 2.2], fontSize: 10, leftAlignedColumns: [0] });
    const panelRows = Array.from({ length: 10 }, (_, index) => {
      const row = (periodData.rows || [])[index];
      return row ? [String(index + 1), row.account, row.description, moneyMillions(row.totalTcv)] : [String(index + 1), '', '', ''];
    });
    addFixedGrid(bcmi, [['#', 'Act Name', 'Description', 'Total TCV'], ...panelRows], { left: panelLeft, top: 444, width: 590, height: 350, columnWeights: [0.45, 1.45, 2.25, 1.05], fontSize: 9, minimumFontSize: 6, leftAlignedColumns: [1, 2] });
  });
  const winRows = (winsData.rows || []).map((row, index) => [String(index + 1), row.account, row.description, moneyMillions(row.netTcv), moneyMillions(row.cyRevenue)]);
  const erosionRows = (erosionData.rows || []).map((row, index) => [String(index + 1), row.account, row.description, moneyMillions(row.amount)]);
  addSectionTitle(bcmi, `WINS · ${winsData.latestWeek ? `WEEK ${winsData.latestWeek}` : 'LATEST WEEK'}`, 60, 824, 980);
  addFixedGrid(bcmi, [['S.No.', 'Account', 'Description', 'Total TCV', '2026-TCV'], ...winRows], { left: 60, top: 862, width: 980, height: 178, columnWeights: [0.5, 1.55, 2.25, 1, 1], fontSize: 10, minimumFontSize: 7, leftAlignedColumns: [1, 2] });
  addSectionTitle(bcmi, `REVENUE EROSION · ${moneyMillions(erosionData.total)}`, 1060, 824, 800);
  addFixedGrid(bcmi, [['S.No.', 'Account', 'Description', 'Amount'], ...erosionRows], { left: 1060, top: 862, width: 800, height: 178, columnWeights: [0.5, 1.6, 2.3, 1], fontSize: 10, minimumFontSize: 7, leftAlignedColumns: [1, 2] });

  const demandSlide = deck.slides.add();
  demandSlide.background.fill = '#ffffff';
  await addText(demandSlide, 'Demand Generation', { left: 60, top: 24, width: 1000, height: 48 }, { fontSize: 42, bold: true, color: NAVY });
  await addText(demandSlide, `Source: ${demand.sourceFilename || 'Saved Demand Creation workbook'}`, { left: 62, top: 72, width: 1000, height: 24 }, { fontSize: 16, color: '#60708c' });
  addSectionTitle(demandSlide, 'DEMAND PROFILE', 60, 112, 820);
  const profile = demand.demandProfile || {};
  const profileColumns = profile.columns || [...(profile.months || []), ...(profile.quarters || [])];
  const profileHeaders = ['BU', 'Total', ...profileColumns.map((item) => item.label)];
  const profileValues = [profileHeaders, ...(profile.rows || []).map((row) => [row.name, value(row.total), ...profileColumns.map((item) => value(row.periods?.[item.key] ?? row.months?.[item.key] ?? row.quarters?.[item.key]))])];
  addFixedGrid(demandSlide, profileValues, { left: 60, top: 150, width: 820, height: 150, columnWeights: [1.2, 0.85, ...profileColumns.map(() => 0.9)], fontSize: 11, leftAlignedColumns: [0] });
  addSectionTitle(demandSlide, 'WEEK ON WEEK DEMAND GENERATION', 900, 112, 960);
  const weekly = demand.series || [];
  demandSlide.charts.add('line', {
    position: { left: 930, top: 155, width: 900, height: 245 },
    categories: weekly.map((row) => row.weekLabel),
    series: [
      { name: 'BCM', values: weekly.map((row) => Number(row.BCM || 0)), fill: BLUE },
      { name: 'INS 2', values: weekly.map((row) => Number(row.INS2 || 0)), fill: ORANGE },
    ],
    hasLegend: true,
    yAxis: { majorGridlines: { style: 'solid', fill: GRID, width: 1 } },
  });
  addSectionTitle(demandSlide, 'TOP 10 ACCOUNTS', 60, 430, 1800);
  const accounts = demand.topAccounts || {};
  const accountColumns = accounts.columns || [...(accounts.months || []), ...(accounts.quarters || [])];
  const accountHeaders = ['S.No', 'Account Name', 'Description', ...accountColumns.map((item) => item.label), 'Total'];
  const accountRows = Array.from({ length: 10 }, (_, index) => {
    const row = (accounts.rows || [])[index];
    return row ? [String(index + 1), row.account, row.description, ...accountColumns.map((item) => value(row.periods?.[item.key] ?? row.months?.[item.key] ?? row.quarters?.[item.key])), value(row.total)] : [String(index + 1), '', '', ...accountColumns.map(() => ''), ''];
  });
  const accountValues = [accountHeaders, ...accountRows];
  addFixedGrid(demandSlide, accountValues, { left: 60, top: 468, width: 1800, height: 560, columnWeights: [0.65, 1.65, 2.2, ...accountColumns.map(() => 0.82), 0.9], fontSize: 12, minimumFontSize: 7, leftAlignedColumns: [1, 2] });

  const qualitySlide = deck.slides.add();
  qualitySlide.background.fill = '#ffffff';
  await addText(qualitySlide, 'Quality of Pipeline', { left: 60, top: 24, width: 1000, height: 48 }, { fontSize: 42, bold: true, color: NAVY });
  await addText(qualitySlide, 'BCM and Insurance 2 pipeline quality, composition, and top opportunities', { left: 62, top: 72, width: 1100, height: 24 }, { fontSize: 16, color: '#60708c' });
  addSectionTitle(qualitySlide, 'QUALITY OF PIPELINE', 60, 112, 1800);
  const qualityHeaders = ['Status', 'Q3', 'Q4', '2026', '2026+', 'Total'];
  const qualityValues = [qualityHeaders, ...(quality.rows || []).map((row) => [row.label, moneyMillions(row.q3), moneyMillions(row.q4), moneyMillions(row.year), moneyMillions(row.yearPlus), moneyMillions(row.total)])];
  addFixedGrid(qualitySlide, qualityValues, { left: 60, top: 150, width: 1800, height: 132, columnWeights: [1.15, 1, 1, 1, 1, 1], fontSize: 14, leftAlignedColumns: [0] });
  addSectionTitle(qualitySlide, 'PIPELINE COMPOSITION', 60, 310, 1800);
  const compositionGroups = [
    ['By Offerings', quality.offerings || []],
    ['By Frontier Model', quality.frontierModels || []],
    ['By Campaign', quality.campaigns || []],
  ];
  for (const [index, [title, items]] of compositionGroups.entries()) {
    const left = 60 + index * 610;
    const categories = items.length ? items.map((item) => item.name) : ['No data loaded'];
    const values = items.length ? items.map((item) => Number(item.percent || 0)) : [1];
    await addText(qualitySlide, title, { left, top: 348, width: 590, height: 28 }, { fontSize: 18, bold: true, color: NAVY, alignment: 'center' });
    qualitySlide.charts.add('doughnut', {
      position: { left: left + 16, top: 378, width: 558, height: 162 },
      categories,
      series: [{
        name: 'Share',
        values,
        points: values.map((_item, pointIndex) => ({ idx: pointIndex, fill: COMPOSITION_COLORS[pointIndex % COMPOSITION_COLORS.length] })),
      }],
      hasLegend: true,
      legend: { position: 'right', overlay: false, textStyle: { fontSize: 10, fill: '#142451' } },
      doughnutOptions: { holeSize: 62, firstSliceAngle: 270 },
      dataLabels: { showPercent: true, position: 'center', textStyle: { fontSize: 10, fill: '#ffffff', bold: true } },
      chartFill: 'none',
      chartLine: { style: 'solid', fill: 'none', width: 0 },
      plotAreaFill: 'none',
      plotAreaLine: { style: 'solid', fill: 'none', width: 0 },
    });
  }
  addSectionTitle(qualitySlide, 'TOP 6 OPPORTUNITIES', 60, 550, 1800);
  const opportunityGroups = [
    ['Across Top Offerings', quality.opportunities || []],
    ['Across Frontier Models', quality.frontierModelOpportunities || []],
    ['Across Top Campaign Themes', quality.campaignOpportunities || []],
  ];
  opportunityGroups.forEach(([title, items], index) => {
    const left = 60 + index * 610;
    addSectionTitle(qualitySlide, title.toUpperCase(), left, 588, 590);
    const rows = Array.from({ length: 6 }, (_, rowIndex) => {
      const item = items[rowIndex];
      return item ? [String(rowIndex + 1), item.account, item.description, moneyMillions(item.totalTcv), moneyMillions(item.yearTcv)] : [String(rowIndex + 1), '', '', '', ''];
    });
    addFixedGrid(qualitySlide, [['S.No', 'Account Name', 'Description', 'Total TCV', '2026 TCV'], ...rows], { left, top: 626, width: 590, height: 402, columnWeights: [0.6, 1.5, 2.15, 1.05, 1.05], fontSize: 10, minimumFontSize: 6, leftAlignedColumns: [1, 2] });
  });

  const qaDirectory = process.env.SALES_DASHBOARD_QA_DIR;
  if (qaDirectory) {
    await fs.mkdir(qaDirectory, { recursive: true });
    for (const [index, slide] of deck.slides.items.entries()) {
      const slideNumber = index + 1;
      const preview = await deck.export({ slide, format: 'png', scale: 1 });
      await fs.writeFile(`${qaDirectory}/slide-${slideNumber}.png`, Buffer.from(await preview.arrayBuffer()));
      const layout = await slide.export({ format: 'layout' });
      await fs.writeFile(`${qaDirectory}/slide-${slideNumber}.layout.json`, await layout.text(), 'utf8');
    }
  }

  const output = await deck.export({ format: 'pptx' });
  process.stdout.write(Buffer.from(await output.arrayBuffer()));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
