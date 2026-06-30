import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from './api.js';
import UploadOption from './upload_option.jsx';

const ENTITY_CONFIG = {
  sls: {
    label: 'SLS',
    formField: 'slsName',
    agentUrl: apiUrl('/api/forecast/analyze'),
    currentUrl: apiUrl('/api/forecast/current'),
    metadataUrl: apiUrl('/api/forecast/current/metadata'),
    savedTableLabel: 'saved revenue_forecast data',
    sheetName: 'Data'
  },
  slsm: {
    label: 'SLSM',
    formField: 'slsmName',
    agentUrl: apiUrl('/api/slsm/forecast/analyze'),
    currentUrl: apiUrl('/api/slsm/forecast/current'),
    metadataUrl: apiUrl('/api/slsm/forecast/current/metadata'),
    savedTableLabel: 'saved slsm_revenue_forecast data',
    sheetName: 'SL_Forecast -2026'
  }
};

const CRC_TABLE = (() => {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export default function SalesRevenue({ slsName, runRequestId, onLoadingChange, onSummaryChange, onMatchedNamesChange, onResultChange, onWorkbookChange, externalWorkbook = null, entity = 'sls' }) {
  const config = ENTITY_CONFIG[entity] || ENTITY_CONFIG.sls;
  const [workbook, setWorkbook] = useState(null);
  const [result, setResult] = useState(null);
  const [savedForecast, setSavedForecast] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    onLoadingChange(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    if (externalWorkbook === workbook) return;

    setWorkbook(externalWorkbook);
    if (externalWorkbook) setSavedForecast(null);
    setError('');
    setResult(null);
    onSummaryChange(null);
    onMatchedNamesChange([]);
    onResultChange(null);
  }, [externalWorkbook]);

  useEffect(() => {
    if (runRequestId > 0) {
      runAgent();
    }
  }, [runRequestId]);

  useEffect(() => {
    const trimmedName = slsName.trim();
    if (!trimmedName) {
      setResult(null);
      onSummaryChange(null);
      onMatchedNamesChange([]);
      onResultChange(null);
      return undefined;
    }

    if (workbook) return undefined;

    const timeoutId = window.setTimeout(() => {
      loadStoredForecast(trimmedName, { silent: true });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [slsName, workbook]);

  useEffect(() => {
    let ignore = false;

    async function loadSavedForecastMetadata() {
      try {
        const response = await fetch(config.metadataUrl);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load saved forecast metadata.');

        if (!ignore && payload.available) {
          setSavedForecast(payload.database);
        }
      } catch {
        if (!ignore) setSavedForecast(null);
      }
    }

    loadSavedForecastMetadata();
    return () => {
      ignore = true;
    };
  }, []);

  const accountRows = useMemo(() => {
    if (!result?.accounts) return [];
    return result.accounts.flatMap((account) => {
      const practices = account.practices.map((practice) => ({ type: 'practice', ...practice }));
      return [
        { type: 'account-heading', account: account.account },
        ...practices,
        { type: 'account-total', ...account }
      ];
    });
  }, [result]);

  async function loadStoredForecast(name = slsName, options = {}) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setResult(null);
      onSummaryChange(null);
      onMatchedNamesChange([]);
      onResultChange(null);
      setError('Enter an ' + config.label + ' name before running analysis.');
      return;
    }

    if (!options.silent) setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({ [config.formField]: trimmedName });
      const url = config.currentUrl + '?' + params.toString();
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load saved forecast.');

      if (payload.available) {
        setSavedForecast(payload.database);
        setResult(payload);
        onSummaryChange(payload.metrics);
        onMatchedNamesChange(payload.matchedSlsNames || []);
        onResultChange(payload);
      } else if (!options.silent) {
        setResult(null);
        onSummaryChange(null);
        onMatchedNamesChange([]);
        onResultChange(null);
        setError('No saved forecast data is available. Upload a workbook first.');
      }
    } catch (err) {
      if (!options.silent) setError(err.message);
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  async function runAgent() {
    if (!workbook) {
      await loadStoredForecast(slsName);
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);
    onSummaryChange(null);
    onMatchedNamesChange([]);
    onResultChange(null);

    const formData = new FormData();
    formData.append('workbook', workbook);
    formData.append(config.formField, slsName);
    formData.append('sheetName', config.sheetName);

    try {
      const response = await fetch(config.agentUrl, {
        method: 'POST',
        body: formData
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Forecast agent failed.');
      setSavedForecast(payload.database);
      setResult(payload);
      onSummaryChange(payload.metrics);
      onMatchedNamesChange(payload.matchedSlsNames || []);
      onResultChange(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function exportExcel() {
    if (!result?.accounts?.length) {
      setError('Run analysis before exporting Excel.');
      return;
    }

    const { sheetRows, merges } = buildForecastSheet(result.accounts);
    const workbook = createXlsxWorkbook(sheetRows, merges);
    downloadBlob(workbook, (slsName || 'SLS') + '_Forecast_2026.xlsx');
  }

  function buildForecastSheet(accounts) {
    const sheetRows = [{
      index: 1,
      cells: [
        { column: 1, value: 'Account', style: 1 },
        { column: 2, value: 'Practice', style: 1 },
        { column: 3, value: "Forecast\nSL_FY'26", style: 1 },
        { column: 4, value: 'Target\nTarget-2026', style: 1 },
        { column: 5, value: "Gap\nFY'26-Gap SL", style: 1 }
      ]
    }];
    const merges = [];
    let rowIndex = 2;

    accounts.forEach((account) => {
      const practices = account.practices || [];
      const firstAccountRow = rowIndex;
      const rowSpan = Math.max(practices.length + 1, 1);
      const accountStyle = 2;

      practices.forEach((practice, practiceIndex) => {
        const cells = [];
        cells.push({
          column: 1,
          value: practiceIndex === 0 ? account.account : '',
          style: accountStyle
        });
        cells.push(
          { column: 2, value: practice.practice, style: 3 },
          { column: 3, value: practice.labels.forecast, style: 4 },
          { column: 4, value: practice.labels.target, style: 4 },
          { column: 5, value: practice.labels.gap, style: statusExcelStyle(practice.status) }
        );
        sheetRows.push({ index: rowIndex, cells });
        rowIndex += 1;
      });

      const totalCells = [];
      totalCells.push({
        column: 1,
        value: practices.length === 0 ? account.account : '',
        style: accountStyle
      });
      totalCells.push(
        { column: 2, value: 'Total', style: 5 },
        { column: 3, value: account.labels.forecast, style: 5 },
        { column: 4, value: account.labels.target, style: 5 },
        { column: 5, value: account.labels.gap, style: statusExcelStyle(account.status, true) }
      );
      sheetRows.push({ index: rowIndex, cells: totalCells });

      if (rowSpan > 1) {
        merges.push('A' + firstAccountRow + ':A' + rowIndex);
      }
      rowIndex += 1;
    });

    return { sheetRows, merges };
  }

  function statusExcelStyle(status, isTotal = false) {
    if (status === 'behind') return isTotal ? 8 : 6;
    if (status === 'ahead') return isTotal ? 9 : 7;
    return isTotal ? 5 : 4;
  }

  function createXlsxWorkbook(sheetRows, merges) {
    const lastRow = sheetRows.at(-1)?.index || 1;
    const worksheet = createWorksheetXml(sheetRows, merges, lastRow);
    const files = {
      '[Content_Types].xml': contentTypesXml(),
      '_rels/.rels': rootRelsXml(),
      'docProps/app.xml': appXml(),
      'docProps/core.xml': coreXml(),
      'xl/workbook.xml': workbookXml(),
      'xl/_rels/workbook.xml.rels': workbookRelsXml(),
      'xl/styles.xml': stylesXml(),
      'xl/worksheets/sheet1.xml': worksheet
    };

    return new Blob([createZip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function createWorksheetXml(sheetRows, merges, lastRow) {
    const rowXml = sheetRows.map((row) => '<row r="' + row.index + '">' + row.cells.map((cell) => createCellXml(row.index, cell)).join('') + '</row>').join('');
    const mergeXml = merges.length ? '<mergeCells count="' + merges.length + '">' + merges.map((ref) => '<mergeCell ref="' + ref + '"/>').join('') + '</mergeCells>' : '';

    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<dimension ref="A1:E' + lastRow + '"/>',
      '<cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/><col min="3" max="5" width="18" customWidth="1"/></cols>',
      '<sheetData>' + rowXml + '</sheetData>',
      mergeXml,
      '</worksheet>'
    ].join('');
  }

  function createCellXml(rowIndex, cell) {
    const ref = columnName(cell.column) + rowIndex;
    const value = escapeXml(cell.value);
    return '<c r="' + ref + '" s="' + cell.style + '" t="inlineStr"><is><t>' + value + '</t></is></c>';
  }

  function columnName(column) {
    let name = '';
    while (column > 0) {
      const remainder = (column - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      column = Math.floor((column - 1) / 26);
    }
    return name;
  }

  function escapeXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="4"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF1F3864"/><name val="Arial"/></font><font><sz val="11"/><color rgb="FFC00000"/><name val="Arial"/></font><font><sz val="11"/><color rgb="FF2E9B4B"/><name val="Arial"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF3FA"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC5D0E0"/></left><right style="thin"><color rgb="FFC5D0E0"/></right><top style="thin"><color rgb="FFC5D0E0"/></top><bottom style="thin"><color rgb="FFC5D0E0"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="10">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>';
  }

  function workbookXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Forecast" sheetId="1" r:id="rId1"/></sheets></workbook>';
  }

  function workbookRelsXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  }

  function contentTypesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  }

  function rootRelsXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
  }

  function appXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>SLS Dashboard</Application></Properties>';
  }

  function coreXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Forecast Export</dc:title><dc:creator>SLS Dashboard</dc:creator></cp:coreProperties>';
  }

  function createZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    Object.entries(files).forEach(([filename, content]) => {
      const nameBytes = encoder.encode(filename);
      const data = encoder.encode(content);
      const crc = crc32(data);
      const localHeader = concatBytes(
        uint32(0x04034b50), uint16(20), uint16(0), uint16(0), uint16(0), uint16(0), uint32(crc), uint32(data.length), uint32(data.length), uint16(nameBytes.length), uint16(0), nameBytes
      );
      localParts.push(localHeader, data);
      centralParts.push(concatBytes(
        uint32(0x02014b50), uint16(20), uint16(20), uint16(0), uint16(0), uint16(0), uint16(0), uint32(crc), uint32(data.length), uint32(data.length), uint16(nameBytes.length), uint16(0), uint16(0), uint16(0), uint16(0), uint32(0), uint32(offset), nameBytes
      ));
      offset += localHeader.length + data.length;
    });

    const centralDirectory = concatBytes(...centralParts);
    const end = concatBytes(uint32(0x06054b50), uint16(0), uint16(0), uint16(centralParts.length), uint16(centralParts.length), uint32(centralDirectory.length), uint32(offset), uint16(0));
    return concatBytes(...localParts, centralDirectory, end);
  }

  function concatBytes(...arrays) {
    const length = arrays.reduce((total, array) => total + array.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    arrays.forEach((array) => {
      output.set(array, offset);
      offset += array.length;
    });
    return output;
  }

  function uint16(value) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return bytes;
  }

  function uint32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    return bytes;
  }

  function crc32(data) {
    let crc = 0xffffffff;
    for (let index = 0; index < data.length; index += 1) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[index]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function selectWorkbook(file, source = 'select') {
    if (!file) {
      setWorkbook(null);
      setSavedForecast(null);
      onWorkbookChange?.(null);
      setError('');
      setResult(null);
      onSummaryChange(null);
      onMatchedNamesChange([]);
      onResultChange(null);
      return;
    }

    const allowed = /\.(xlsb|xlsx|xlsm)$/i.test(file.name);
    if (!allowed) {
      setWorkbook(null);
      setSavedForecast(null);
      onWorkbookChange?.(null);
      setError('Please ' + (source === 'drop' ? 'drop' : 'select') + ' a .xlsb, .xlsx, or .xlsm workbook.');
      setResult(null);
      onSummaryChange(null);
      onMatchedNamesChange([]);
      onResultChange(null);
      return;
    }

    setWorkbook(file);
    setSavedForecast(null);
    onWorkbookChange?.(file);
    setError('');
    setResult(null);
    onSummaryChange(null);
    onMatchedNamesChange([]);
    onResultChange(null);
  }

  const uploadTitle = workbook
    ? workbook.name
    : savedForecast?.sourceFilename || 'Drop your revenue workbook here';
  const uploadSubtitle = workbook
    ? 'Revenue workbook selected - ready to analyse'
    : savedForecast?.rowsSaved
      ? savedForecast.rowsSaved.toLocaleString() + ' rows loaded from ' + config.savedTableLabel
      : 'Supports .xlsb and .xlsx - processed by the Python agent';

  return (
    <>
      <UploadOption
        className="revenue-upload"
        label="Revenue"
        title={uploadTitle}
        subtitle={uploadSubtitle}
        icon="revenue"
        isComplete={Boolean(workbook)}
        onFileSelect={selectWorkbook}
      />

      <section className="revenue-flow">
        {error && <p className="error">{error}</p>}
      </section>
    </>
  );
}

function statusClass(status) {
  if (status === 'behind') return 'red';
  if (status === 'ahead') return 'green';
  return 'muted';
}
