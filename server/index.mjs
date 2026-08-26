import Database from 'better-sqlite3';
import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import path from 'node:path';

const port = Number(process.env.PORT || 3002);
const dataPath = process.env.SALES_DASHBOARD_NODE_DB_PATH || path.resolve('sales_dashboard_node.db');
const db = new Database(dataPath);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS node_uploads (
  kind TEXT PRIMARY KEY, source_filename TEXT NOT NULL, headers_json TEXT NOT NULL,
  rows_json TEXT NOT NULL, updated_at TEXT NOT NULL
)`);

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
app.use(express.json({ limit: '2mb' }));
app.use((_, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });

const money = (value) => `$${(Number(value || 0) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
const key = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const aliases = { sls: ['sls'], slsm: ['slsm', 'slsm name', 'sls manager'], account: ['parent account name', 'financial ultimate parent account', 'account'], practice: ['practice area', 'practice'] };

function parseWorkbook(file, sheetName = 'Data') {
  if (!file?.buffer) throw new Error('A workbook is required.');
  const workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
  const selected = workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
  if (!selected) throw new Error(`Sheet "${sheetName}" was not found.`);
  const raw = XLSX.utils.sheet_to_json(workbook.Sheets[selected], { header: 1, defval: null, raw: true });
  const headerIndex = raw.findIndex((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim()));
  if (headerIndex < 0) throw new Error('The workbook does not contain a header row.');
  const headers = raw[headerIndex].map((cell, index) => String(cell ?? '').trim() || `Column ${index + 1}`);
  const rows = raw.slice(headerIndex + 1).filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''));
  return { headers, rows };
}
function parseRaWorkbook(file) {
  if (!file?.buffer) throw new Error('An RA workbook is required.');
  const workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
  const sheetNames = ['Q3 BU RA - Americas', 'Q4 RA - Americas'];
  const extracted = sheetNames.map((sheetName) => {
    if (!workbook.SheetNames.includes(sheetName)) throw new Error(`Sheet "${sheetName}" was not found in workbook.`);
    const values = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
    const headerIndex = values.findIndex((row) => Array.isArray(row) && row.map((cell) => String(cell ?? '').trim()).includes('Account') && row.map((cell) => String(cell ?? '').trim()).includes('BU'));
    if (headerIndex < 0) throw new Error(`Missing the Account and BU header row in "${sheetName}".`);
    const headers = values[headerIndex].map((cell, index) => (cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell ?? '').trim()) || `Column ${index + 1}`);
    const accountIndex = headers.indexOf('Account');
    return { sheetName, headers, rows: values.slice(headerIndex + 1).filter((row) => String(row[accountIndex] ?? '').trim()) };
  });
  const headers = ['Sheet Name', ...extracted[0].headers];
  const rows = extracted.flatMap(({ sheetName, headers: sourceHeaders, rows: sourceRows }) => {
    const positions = new Map(sourceHeaders.map((header, index) => [key(header), index]));
    return sourceRows.map((row) => [sheetName, ...headers.slice(1).map((header) => positions.has(key(header)) ? row[positions.get(key(header))] : null)]);
  });
  return { headers, rows };
}
function parseFrontierSecurityDefenseWorkbook(file) {
  if (!file?.buffer) throw new Error('A Frontier Security & Defense workbook is required.');
  const workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
  const sheetName = 'Opportunity Input';
  if (!workbook.SheetNames.includes(sheetName)) throw new Error(`Sheet "${sheetName}" was not found in workbook.`);
  const values = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
  const requiredColumns = ['BU *', 'Account Name *', 'Winzone ID *', 'Opportunity Name *', 'Frontier Model *', 'SEG TCV Value (USD) *'];
  const headerIndex = values.findIndex((row) => Array.isArray(row) && requiredColumns.every((columnName) => row.map((cell) => String(cell ?? '').trim()).includes(columnName)));
  if (headerIndex < 0) throw new Error('Missing the required opportunity columns in the Opportunity Input sheet.');
  const headers = values[headerIndex].map((cell, index) => String(cell ?? '').trim() || `Column ${index + 1}`);
  const businessUnitIndex = headers.indexOf('BU *');
  const rows = values.slice(headerIndex + 1).filter((row) => String(row[businessUnitIndex] ?? '').trim());
  return { sheetName, headers, rows };
}

function save(kind, parsed, filename) {
  db.prepare(`INSERT INTO node_uploads(kind, source_filename, headers_json, rows_json, updated_at)
    VALUES (@kind, @source, @headers, @rows, @updated)
    ON CONFLICT(kind) DO UPDATE SET source_filename=excluded.source_filename, headers_json=excluded.headers_json, rows_json=excluded.rows_json, updated_at=excluded.updated_at`)
    .run({ kind, source: filename || 'workbook.xlsx', headers: JSON.stringify(parsed.headers), rows: JSON.stringify(parsed.rows), updated: new Date().toISOString() });
  return metadata(kind);
}
function raw(kind) {
  const row = db.prepare('SELECT * FROM node_uploads WHERE kind = ?').get(kind);
  return row ? { headers: JSON.parse(row.headers_json), rows: JSON.parse(row.rows_json), sourceFilename: row.source_filename } : { headers: [], rows: [], sourceFilename: null };
}
function metadata(kind) {
  const data = raw(kind);
  return { available: data.rows.length > 0, table: kind, rowsSaved: data.rows.length, sourceFilename: data.sourceFilename };
}
function merge(primary, insurance) {
  const a = raw(primary), b = raw(insurance);
  if (!a.rows.length) return b;
  if (!b.rows.length) return a;
  const headers = [...a.headers]; const seen = new Set(headers.map(key));
  b.headers.forEach((header) => { if (!seen.has(key(header))) { seen.add(key(header)); headers.push(header); } });
  const align = ({ headers: sourceHeaders, rows }) => {
    const positions = new Map(sourceHeaders.map((header, index) => [key(header), index]));
    return rows.map((row) => headers.map((header) => positions.has(key(header)) ? row[positions.get(key(header))] : null));
  };
  return { headers, rows: [...align(a), ...align(b)], sourceFilename: [a.sourceFilename, b.sourceFilename].filter(Boolean).join(' + ') };
}
function column(headers, names) { const lookup = new Map(headers.map((header, index) => [key(header), index])); return names.map(key).find((name) => lookup.has(name)) !== undefined ? lookup.get(names.map(key).find((name) => lookup.has(name))) : -1; }
function value(row, index) { return index >= 0 ? row[index] : null; }
function number(value) { if (typeof value === 'number') return value; return Number(String(value ?? '').replace(/[$,]/g, '')) || 0; }
function personRows(data, name, dimension) { const index = column(data.headers, aliases[dimension]); const query = key(name); return index < 0 ? [] : data.rows.filter((row) => key(value(row, index)) === query); }
function uniquePeople(data, dimension) { const index = column(data.headers, aliases[dimension]); return index < 0 ? [] : [...new Set(data.rows.map((row) => String(value(row, index) || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b)); }

function revenueData() { return merge('revenue_forecast', 'insurance_revenue_forecast'); }
function pipelineData() { return merge('pipeline_upload', 'insurance_pipeline_upload'); }
function revenueMetrics(data, name, dimension = 'sls') {
  const rows = personRows(data, name, dimension); const headers = data.headers;
  const forecastIndex = column(headers, ['fy 26 (sl)', "sl_fy'26", 'forecast']); const targetIndex = column(headers, ['target 2026', 'target-2026', 'target']);
  const sourceIndex = column(headers, ['p&l source']); const headerIndex = column(headers, ['p&l header']);
  const usable = rows.filter((row) => (sourceIndex < 0 || ['ic/forecasted', 'budget', ''].includes(key(value(row, sourceIndex)))) && (headerIndex < 0 || key(value(row, headerIndex)).includes('net revenue')));
  const forecast = usable.reduce((sum, row) => sum + number(value(row, forecastIndex)), 0); const target = usable.reduce((sum, row) => sum + number(value(row, targetIndex)), 0);
  return { forecast, target, gap: target - forecast, accounts: new Set(usable.map((row) => value(row, column(headers, aliases.account))).filter(Boolean)).size, rows: usable.length, labels: { forecast: money(forecast), target: money(target), gap: money(target - forecast) }, status: target - forecast > 0 ? 'behind' : target - forecast < 0 ? 'ahead' : 'on-track' };
}
function pipelineMetrics(data, name, dimension = 'sls', type = 'pipeline') {
  const rows = personRows(data, name, dimension); const headers = data.headers; const stageIndex = column(headers, ['grouped sales stage', 'sales stage']); const amountIndex = column(headers, ['net tcv share', 'tcv', 'amount']); const accountIndex = column(headers, aliases.account);
  const applicable = rows.filter((row) => { const stage = key(value(row, stageIndex)); return type === 'won' ? stage === 'won' : type === 'pending' ? key(value(row, column(headers, ['sub-status']))) === 'pending validation' : !['won', 'lost'].includes(stage); });
  const total = applicable.reduce((sum, row) => sum + number(value(row, amountIndex)), 0); const qualified = applicable.filter((row) => key(value(row, stageIndex)).includes('qualified') && !key(value(row, stageIndex)).includes('un-qualified')).reduce((sum, row) => sum + number(value(row, amountIndex)), 0); const unqualified = applicable.filter((row) => key(value(row, stageIndex)).includes('un-qualified')).reduce((sum, row) => sum + number(value(row, amountIndex)), 0);
  return type === 'pipeline' ? { pipeline: total, qualified, unqualified, accounts: new Set(applicable.map((row) => value(row, accountIndex)).filter(Boolean)).size, rows: applicable.length, labels: { pipeline: money(total), qualified: money(qualified), unqualified: money(unqualified) } } : { [type === 'won' ? 'won' : 'pendingValidation']: total, rows: applicable.length, labels: { [type === 'won' ? 'won' : 'pendingValidation']: money(total) } };
}
function pipelineResult(name, dimension = 'sls') { const data = pipelineData(); const metrics = pipelineMetrics(data, name, dimension); return { available: data.rows.length > 0, query: name, year: new Date().getFullYear(), matchedSlsNames: uniquePeople(data, dimension).filter((item) => key(item) === key(name)), metrics, accounts: [], rows: [], database: { table: 'pipeline_upload', rowsSaved: data.rows.length, sourceFilename: data.sourceFilename } }; }
function forecastResult(name, dimension = 'sls') { const data = revenueData(); const metrics = revenueMetrics(data, name, dimension); return { available: data.rows.length > 0, query: name, matchedSlsNames: uniquePeople(data, dimension).filter((item) => key(item) === key(name)), metrics, accounts: [], rows: [], database: { table: 'revenue_forecast', rowsSaved: data.rows.length, sourceFilename: data.sourceFilename } }; }
function recentPipelineRows(parsed) { const marker = column(parsed.headers, ['opportunity created in two weeks or old']); return marker < 0 ? parsed.rows : parsed.rows.filter((row) => key(value(row, marker)) === 'opportunity created in two weeks'); }
function latestPipelineWeekRows(data) { const created = column(data.headers, ['created date']); if (created < 0) return data.rows; const dates = data.rows.map((row) => { const raw = value(row, created); const numeric = Number(raw); if (Number.isFinite(numeric)) return new Date(Date.UTC(1899, 11, 30 + numeric)); const parsed = new Date(String(raw || '')); return Number.isNaN(parsed.valueOf()) ? null : parsed; }); const latest = dates.filter(Boolean).reduce((maximum, date) => !maximum || date > maximum ? date : maximum, null); if (!latest) return data.rows; const cutoff = new Date(latest); cutoff.setUTCDate(cutoff.getUTCDate() - 6); return data.rows.filter((_, index) => dates[index] && dates[index] >= cutoff); }
function campaignName(row, index) { const raw = value(row, index); const name = raw === null || raw === undefined ? '' : String(raw).trim(); return ['none', 'n/a', 'na', '-'].includes(key(name)) ? '' : name; }
function refreshQualityPipelineData() { [['pipeline_upload', 'quality_pipeline_bcm_upload'], ['insurance_pipeline_upload', 'quality_pipeline_insurance_upload']].forEach(([source, target]) => { const data = raw(source); if (data.rows.length) save(target, { headers: data.headers, rows: recentPipelineRows(data) }, data.sourceFilename); }); }
function qualityPipelineSummary() {
  refreshQualityPipelineData();
  const data = merge('quality_pipeline_bcm_upload', 'quality_pipeline_insurance_upload');
  if (!data.rows.length) return { available: false, rows: [], offerings: [], campaigns: [], opportunities: [], campaignOpportunities: [], database: { table: 'quality_pipeline_bcm_upload + quality_pipeline_insurance_upload', rowsSaved: 0 } };
  const stageIndex = column(data.headers, ['grouped sales stage']);
  const subStatusIndex = column(data.headers, ['sub-status']);
  const offeringIndex = column(data.headers, ['offering/solutions']);
  const campaignIndex = column(data.headers, ['campaign theme']);
  const accountIndex = column(data.headers, ['financial ultimate parent account', 'account name']);
  const opportunityIndex = column(data.headers, ['opportunity name']);
  const opportunityIdIndex = column(data.headers, ['winzone opportunity id']);
  const periods = {
    q3: column(data.headers, ['cy q3 $']),
    q4: column(data.headers, ['cy q4 $']),
    year: column(data.headers, ['cy $', 'current year revenue (converted)']),
    yearPlus: column(data.headers, ['ny $']),
    total: column(data.headers, ['net tcv share (converted)', 'net tcv share'])
  };
  const totals = Object.fromEntries(['Qualified', 'Unqualified'].map((label) => [label, Object.fromEntries(Object.keys(periods).map((period) => [period, 0]))]));
  const offeringTotals = new Map(); const campaignTotals = new Map(); const candidateRows = [];
  data.rows.forEach((row) => {
    const stage = String(value(row, stageIndex) || '').trim();
    const label = stage === 'Qualified' ? 'Qualified' : stage === 'Un-Qualified' ? 'Unqualified' : null;
    if (!label || key(value(row, subStatusIndex)) === 'negotiation') return;
    Object.entries(periods).forEach(([period, index]) => { totals[label][period] += number(value(row, index)); });
  });
  latestPipelineWeekRows(data).forEach((row) => {
    const stage = String(value(row, stageIndex) || '').trim();
    if (!['Qualified', 'Un-Qualified'].includes(stage) || key(value(row, subStatusIndex)) === 'negotiation') return;
    const offering = String(value(row, offeringIndex) || '').trim() || 'Unspecified'; const total = number(value(row, periods.total)); offeringTotals.set(offering, (offeringTotals.get(offering) || 0) + total); const campaign = campaignName(row, campaignIndex); if (campaign) campaignTotals.set(campaign, (campaignTotals.get(campaign) || 0) + total); candidateRows.push(row);
  });
  const topCategories = (totalsByCategory) => { const categories = [...totalsByCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3); const total = categories.reduce((sum, [, value]) => sum + value, 0); return categories.map(([name, totalTcv]) => ({ name, totalTcv, percent: total ? totalTcv / total * 100 : 0 })); };
  const topOfferings = topCategories(offeringTotals); const topCampaigns = topCategories(campaignTotals); const selectedOfferings = new Set(topOfferings.map(({ name }) => name)); const selectedCampaigns = new Set(topCampaigns.map(({ name }) => name)); const opportunities = new Map(); const campaignOpportunities = new Map();
  candidateRows.forEach((row) => { const offering = String(value(row, offeringIndex) || '').trim() || 'Unspecified'; const campaign = campaignName(row, campaignIndex); const account = String(value(row, accountIndex) || '').trim(); const description = String(value(row, opportunityIndex) || '').trim(); const id = String(value(row, opportunityIdIndex) || '').trim() || `${account}|${description}`; const totalTcv = number(value(row, periods.total)); const yearTcv = number(value(row, periods.year)); if (selectedOfferings.has(offering)) { const item = opportunities.get(id) || { account, description, offering, totalTcv: 0, yearTcv: 0 }; item.totalTcv += totalTcv; item.yearTcv += yearTcv; opportunities.set(id, item); } if (selectedCampaigns.has(campaign)) { const item = campaignOpportunities.get(id) || { account, description, campaign, totalTcv: 0, yearTcv: 0 }; item.totalTcv += totalTcv; item.yearTcv += yearTcv; campaignOpportunities.set(id, item); } });
  return { available: true, rows: Object.entries(totals).map(([label, values]) => ({ label, ...values })), offerings: topOfferings, campaigns: topCampaigns, opportunities: [...opportunities.values()].sort((a, b) => b.totalTcv - a.totalTcv).slice(0, 6), campaignOpportunities: [...campaignOpportunities.values()].sort((a, b) => b.totalTcv - a.totalTcv).slice(0, 6), database: { table: 'quality_pipeline_bcm_upload + quality_pipeline_insurance_upload', rowsSaved: data.rows.length, displayRows: latestPipelineWeekRows(data).length, sourceFilename: data.sourceFilename } };
}
function bcmiOrigRevenueSummary() {
  const data = revenueData();
  if (!data.rows.length) return { available: false, metrics: {}, database: { table: 'revenue_forecast', rowsSaved: 0 } };
  const periods = {
    aug: column(data.headers, ['serviceline_aug 2026', 'market_aug 2026']),
    q3: column(data.headers, ["q3'26 (sl)", 'q3 26 (sl)']),
    q4: column(data.headers, ["q4'26 (sl)", 'q4 26 (sl)']),
    year: column(data.headers, ['fy 26 (sl)', 'fy26 (sl)'])
  };
  const sourceIndex = column(data.headers, ['p&l source', 'plsource']);
  const headerIndex = column(data.headers, ['p&l header', 'plheader']);
  const metrics = Object.fromEntries(Object.keys(periods).map((period) => [period, 0]));
  data.rows.forEach((row) => {
    if (sourceIndex >= 0 && String(value(row, sourceIndex) || '').trim() !== 'IC/Forecasted') return;
    if (headerIndex >= 0 && String(value(row, headerIndex) || '').trim() !== 'Net Revenue') return;
    Object.entries(periods).forEach(([period, index]) => { metrics[period] += number(value(row, index)); });
  });
  return { available: true, metrics, database: { table: 'revenue_forecast', rowsSaved: data.rows.length, sourceFilename: data.sourceFilename } };
}
function bcmiOrigRaSummary() {
  const data = raw('ra_upload');
  if (!data.rows.length) return { available: false, metrics: {} };
  const sheetIndex = 0;
  const valueAt = (row, index) => number(value(row, index));
  const indexes = (fragment) => data.headers.map((header, index) => key(header).includes(key(fragment)) ? index : -1).filter((index) => index >= 0);
  const q3Index = indexes("q3'26 revenue")[0];
  const q4Index = indexes("q4'26 revenue")[0];
  if (q3Index === undefined || q4Index === undefined) return { available: false, metrics: {} };
  const sum = (sheetName, indexList) => data.rows.filter((row) => value(row, sheetIndex) === sheetName).reduce((total, row) => total + indexList.reduce((subtotal, index) => subtotal + valueAt(row, index), 0), 0);
  const q3 = sum('Q3 BU RA - Americas', [q3Index]);
  const q4 = sum('Q4 RA - Americas', [q4Index]);
  const aug = sum('Q3 BU RA - Americas', indexes('2026-08-01'));
  return { available: true, metrics: { aug, q3, q4, year: q3 + q4 }, sourceFilename: data.sourceFilename };
}
function bcmiOrigBiweeklyWins() {
  const data = pipelineData();
  const indexes = {
    stage: column(data.headers, ['grouped sales stage']),
    week: column(data.headers, ['week closed']),
    year: column(data.headers, ['year closed']),
    account: column(data.headers, ['financial ultimate parent account', 'account name']),
    description: column(data.headers, ['opportunity name']),
    netTcv: column(data.headers, ['net tcv share', 'net tcv share (converted)']),
    cyRevenue: column(data.headers, ['cy revenue $', 'current year revenue (converted)'])
  };
  const weekNumber = (item) => { const match = String(item ?? '').match(/\d+/); return match ? Number(match[0]) : null; };
  const wins = data.rows.map((row) => ({ row, week: weekNumber(value(row, indexes.week)) })).filter(({ row, week }) => String(value(row, indexes.stage) || '').trim() === 'Won' && String(value(row, indexes.year) || '').startsWith('2026') && week !== null);
  if (!wins.length) return { available: false, rows: [] };
  const latestWeek = Math.max(...wins.map(({ week }) => week));
  const rows = wins.filter((item) => item.week === latestWeek).sort((a, b) => number(value(b.row, indexes.netTcv)) - number(value(a.row, indexes.netTcv))).slice(0, 5).map(({ row }) => ({ account: String(value(row, indexes.account) || '').trim(), description: String(value(row, indexes.description) || '').trim(), netTcv: number(value(row, indexes.netTcv)), cyRevenue: number(value(row, indexes.cyRevenue)) }));
  return { available: true, latestWeek, rows, sourceFilename: data.sourceFilename };
}

app.get('/health', (_, res) => res.json({ ok: true, agent: 'sls-forecast-agent-node', backend: 'node' }));
function mergedMetadata(primary, insurance) { const a = metadata(primary), b = metadata(insurance); return { available: a.available || b.available, database: { ...a, available: a.available || b.available, rowsSaved: a.rowsSaved + b.rowsSaved, sourceFilename: [a.sourceFilename, b.sourceFilename].filter(Boolean).join(' + '), insuranceRowsSaved: b.rowsSaved } }; }
app.get('/api/forecast/current/metadata', (_, res) => res.json(mergedMetadata('revenue_forecast', 'insurance_revenue_forecast')));
app.get('/api/forecast/insurance/upload/metadata', (_, res) => res.json({ available: metadata('insurance_revenue_forecast').available, database: metadata('insurance_revenue_forecast') }));
app.get('/api/bcmi-orig/revenue-summary', (_, res) => res.json(bcmiOrigRevenueSummary()));
app.get('/api/bcmi-orig/ra-summary', (_, res) => res.json(bcmiOrigRaSummary()));
app.get('/api/bcmi-orig/biweekly-wins', (_, res) => res.json(bcmiOrigBiweeklyWins()));
app.get('/api/pipeline/upload/metadata', (_, res) => res.json(mergedMetadata('pipeline_upload', 'insurance_pipeline_upload')));
app.get('/api/pipeline/insurance/upload/metadata', (_, res) => res.json({ available: metadata('insurance_pipeline_upload').available, database: metadata('insurance_pipeline_upload') }));
app.get('/api/quality-pipeline/summary', (_, res) => res.json(qualityPipelineSummary()));
app.get('/api/slsm/forecast/current/metadata', (_, res) => res.json(mergedMetadata('revenue_forecast', 'insurance_revenue_forecast')));
app.get('/api/slsm/pipeline/upload/metadata', (_, res) => res.json(mergedMetadata('pipeline_upload', 'insurance_pipeline_upload')));

function uploadRoute(pathname, kind, sheet = 'Data') { app.post(pathname, upload.single('workbook'), (req, res) => { try { const record = save(kind, parseWorkbook(req.file, req.body.sheetName || sheet), req.file.originalname); res.json({ available: record.available, database: record }); } catch (error) { res.status(400).json({ detail: error.message }); } }); }
function pipelineUploadRoute(pathname, kind, qualityKind) { app.post(pathname, upload.single('workbook'), (req, res) => { try { const parsed = parseWorkbook(req.file, req.body.sheetName || 'Data'); const record = save(kind, parsed, req.file.originalname); const qualityRecord = save(qualityKind, { headers: parsed.headers, rows: recentPipelineRows(parsed) }, req.file.originalname); res.json({ available: record.available, database: { ...record, qualityPipelineRowsSaved: qualityRecord.rowsSaved } }); } catch (error) { res.status(400).json({ detail: error.message }); } }); }
uploadRoute('/api/forecast/upload', 'revenue_forecast'); uploadRoute('/api/forecast/insurance/upload', 'insurance_revenue_forecast');
pipelineUploadRoute('/api/pipeline/upload', 'pipeline_upload', 'quality_pipeline_bcm_upload'); pipelineUploadRoute('/api/pipeline/insurance/upload', 'insurance_pipeline_upload', 'quality_pipeline_insurance_upload');
uploadRoute('/api/slsm/forecast/upload', 'revenue_forecast', 'SL_Forecast -2026'); uploadRoute('/api/slsm/pipeline/upload', 'pipeline_upload');
app.post('/api/reports/ra/upload', upload.single('workbook'), (req, res) => { try { const record = save('ra_upload', parseRaWorkbook(req.file), req.file.originalname); res.json({ available: record.available, sourceFilename: req.file.originalname, database: record }); } catch (error) { res.status(400).json({ detail: error.message }); } });
app.post('/api/reports/frontier-security-defense/upload', upload.single('workbook'), (req, res) => { try { const parsed = parseFrontierSecurityDefenseWorkbook(req.file); const record = save('frontier_security_defense_upload', parsed, req.file.originalname); res.json({ available: record.available, sourceFilename: req.file.originalname, database: record, ...parsed }); } catch (error) { res.status(400).json({ detail: error.message }); } });

app.get('/api/forecast/current', (req,res) => res.json(forecastResult(req.query.slsName || '', 'sls')));
app.get('/api/slsm/forecast/current', (req,res) => res.json(forecastResult(req.query.slsmName || '', 'slsm')));
app.get('/api/slsm/forecast/options/current', (_,res) => { const data = revenueData(); const pipe = pipelineData(); res.json({ available: data.rows.length + pipe.rows.length > 0, options: [...new Set([...uniquePeople(data, 'slsm'), ...uniquePeople(pipe, 'slsm')])].sort((a,b)=>a.localeCompare(b)), database: { table: 'revenue_forecast', rowsSaved: data.rows.length, sourceFilename: data.sourceFilename } }); });
app.get('/api/pipeline/summary/current', (req,res) => res.json(pipelineResult(req.query.slsName || '', 'sls')));
app.get('/api/slsm/pipeline/summary/current', (req,res) => res.json(pipelineResult(req.query.slsmName || '', 'slsm')));
app.get('/api/reports/ra/current', (_, res) => { const record = metadata('ra_upload'); res.json({ available: record.available, sourceFilename: record.sourceFilename, rowsSaved: record.rowsSaved }); });
app.get('/api/reports/frontier-security-defense/current', (_, res) => { const record = raw('frontier_security_defense_upload'); res.json({ available: record.rows.length > 0, sourceFilename: record.sourceFilename, rowsSaved: record.rows.length, sheetName: 'Opportunity Input', headers: record.headers, rows: record.rows }); });
for (const [route, dimension, query, type] of [['/api/won-lost/summary/current','sls','slsName','won'],['/api/slsm/won-lost/summary/current','slsm','slsmName','won'],['/api/pending-validation/summary/current','sls','slsName','pending'],['/api/slsm/pending-validation/summary/current','slsm','slsmName','pending']]) app.get(route, (req,res) => { const data = pipelineData(); const metrics = pipelineMetrics(data, req.query[query] || '', dimension, type); res.json({ available: data.rows.length > 0, query: req.query[query] || '', metrics, database: { table: 'pipeline_upload', rowsSaved: data.rows.length, sourceFilename: data.sourceFilename } }); });
app.get('/api/slsl/summary/current', (_, res) => { const rev = revenueData(), pipe = pipelineData(); const names = [...new Set([...uniquePeople(rev,'slsm'), ...uniquePeople(pipe,'slsm')])]; const rows = names.map((slsmName) => { const revenue = revenueMetrics(rev,slsmName,'slsm'), pipeline = pipelineMetrics(pipe,slsmName,'slsm'), won = pipelineMetrics(pipe,slsmName,'slsm','won'), pending = pipelineMetrics(pipe,slsmName,'slsm','pending'); const total = won.won + pending.pendingValidation; return { slsmName, revenue, pipeline, realizedTcv: { total, won: won.won, pendingValidation: pending.pendingValidation, rows: won.rows + pending.rows, labels: { total: money(total), won: won.labels.won, pendingValidation: pending.labels.pendingValidation } } }; }); res.json({ available: rows.length > 0, year: new Date().getFullYear(), rows, database: { revenue: { rowsSaved: rev.rows.length, sourceFilename: rev.sourceFilename }, pipeline: { rowsSaved: pipe.rows.length, sourceFilename: pipe.sourceFilename } } }); });
app.get('/api/slsm/sls-breakdown/current', (req,res) => { const name = req.query.slsmName || ''; if (!name) return res.status(400).json({ detail: 'SLSM name is required.' }); const rev = revenueData(), pipe = pipelineData(); const names = [...new Set([...personRows(rev,name,'slsm').map((row)=>String(value(row,column(rev.headers,aliases.sls))||'').trim()), ...personRows(pipe,name,'slsm').map((row)=>String(value(row,column(pipe.headers,aliases.sls))||'').trim())])].filter(Boolean); const rows = names.map((slsName) => { const revenue=revenueMetrics(rev,slsName,'sls'), pipeline=pipelineMetrics(pipe,slsName,'sls'), won=pipelineMetrics(pipe,slsName,'sls','won'), pending=pipelineMetrics(pipe,slsName,'sls','pending'); const total=won.won+pending.pendingValidation; return {slsName,revenue,pipeline,realizedTcv:{total,won:won.won,pendingValidation:pending.pendingValidation,rows:won.rows+pending.rows,labels:{total:money(total),won:won.labels.won,pendingValidation:pending.labels.pendingValidation}}}; }).filter((row)=>[row.revenue.forecast,row.revenue.target,row.revenue.gap,row.pipeline.pipeline,row.pipeline.qualified,row.pipeline.unqualified,row.realizedTcv.total].some(Boolean)); res.json({available:rows.length>0,query:name,year:new Date().getFullYear(),rows}); });

app.use((req, res) => res.status(501).json({ detail: `Node fallback route not yet implemented: ${req.method} ${req.path}` }));
app.listen(port, '0.0.0.0', () => console.log(`Sales Dashboard Node API listening on http://0.0.0.0:${port}`));
