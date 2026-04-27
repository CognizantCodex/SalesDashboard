import React, { useMemo, useState } from 'react';
import SalesSummary from './sales_summary.jsx';

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

export default function SalesTcvDetails({ wonLostSummary, pendingValidationSummary, onBack, entityLabel = 'SLS' }) {
  const [error, setError] = useState('');
  const [dealTypeFilter, setDealTypeFilter] = useState('All');
  const dealTypeOptions = useMemo(() => {
    const dealTypes = new Set([
      ...(wonLostSummary?.rows || []).map((row) => row.dealType || 'Unspecified'),
      ...(pendingValidationSummary?.rows || []).map((row) => row.dealType || 'Unspecified')
    ]);
    return ['All', ...Array.from(dealTypes).sort()];
  }, [wonLostSummary, pendingValidationSummary]);
  const combinedAccounts = useMemo(
    () => buildCombinedAccounts(wonLostSummary?.rows || [], pendingValidationSummary?.rows || [], dealTypeFilter),
    [wonLostSummary, pendingValidationSummary, dealTypeFilter]
  );
  const filteredWonLostSummary = useMemo(
    () => buildFilteredWonLostSummary(wonLostSummary, combinedAccounts, dealTypeFilter),
    [wonLostSummary, combinedAccounts, dealTypeFilter]
  );
  const filteredPendingValidationSummary = useMemo(
    () => buildFilteredPendingValidationSummary(pendingValidationSummary, combinedAccounts, dealTypeFilter),
    [pendingValidationSummary, combinedAccounts, dealTypeFilter]
  );
  const accountRows = useMemo(() => {
    return combinedAccounts.flatMap((account) => {
      const practices = account.practices.map((practice) => ({ type: 'practice', ...practice }));
      return [
        { type: 'account-heading', account: account.account },
        ...practices,
        { type: 'account-total', ...account }
      ];
    });
  }, [combinedAccounts]);
  const year = wonLostSummary?.year || pendingValidationSummary?.year || new Date().getFullYear();
  const queryName = wonLostSummary?.query || pendingValidationSummary?.query || entityLabel;

  function exportExcel() {
    if (!combinedAccounts.length) {
      setError('TCV details are not available to export.');
      return;
    }

    const { sheetRows, merges } = buildTcvSheet(combinedAccounts);
    const workbook = createXlsxWorkbook(sheetRows, merges);
    const dealTypeSuffix = dealTypeFilter === 'All' ? '' : '_' + safeFileName(dealTypeFilter);
    downloadBlob(workbook, queryName + '_TCV_' + year + dealTypeSuffix + '.xlsx');
  }

  function buildTcvSheet(accounts) {
    const sheetRows = [{
      index: 1,
      cells: [
        { column: 1, value: 'Account', style: 1 },
        { column: 2, value: 'Practice', style: 1 },
        { column: 3, value: 'Total TCV', style: 1 },
        { column: 4, value: 'Won TCV', style: 1 },
        { column: 5, value: 'Pending Validation TCV', style: 1 }
      ]
    }];
    const merges = [];
    let rowIndex = 2;

    const grandTotal = {
      total: 0,
      won: 0,
      pendingValidation: 0
    };

    accounts.forEach((account) => {
      const practices = account.practices || [];
      const firstAccountRow = rowIndex;
      const rowSpan = Math.max(practices.length + 1, 1);
      grandTotal.total += account.total || 0;
      grandTotal.won += account.won || 0;
      grandTotal.pendingValidation += account.pendingValidation || 0;

      practices.forEach((practice, practiceIndex) => {
        sheetRows.push({
          index: rowIndex,
          cells: [
            { column: 1, value: practiceIndex === 0 ? account.account : '', style: 2 },
            { column: 2, value: practice.practice, style: 3 },
            { column: 3, value: practice.labels.total, style: 4 },
            { column: 4, value: practice.labels.won, style: 4 },
            { column: 5, value: practice.labels.pendingValidation, style: 4 }
          ]
        });
        rowIndex += 1;
      });

      sheetRows.push({
        index: rowIndex,
        cells: [
          { column: 1, value: practices.length === 0 ? account.account : '', style: 2 },
          { column: 2, value: 'Total', style: 5 },
          { column: 3, value: account.labels.total, style: 5 },
          { column: 4, value: account.labels.won, style: 5 },
          { column: 5, value: account.labels.pendingValidation, style: 5 }
        ]
      });

      if (rowSpan > 1) {
        merges.push('A' + firstAccountRow + ':A' + rowIndex);
      }
      rowIndex += 1;
    });

    sheetRows.push({
      index: rowIndex,
      cells: [
        { column: 1, value: 'Grand Total', style: 5 },
        { column: 2, value: '', style: 5 },
        { column: 3, value: formatPipelineMoney(grandTotal.total), style: 5 },
        { column: 4, value: formatPipelineMoney(grandTotal.won), style: 5 },
        { column: 5, value: formatPipelineMoney(grandTotal.pendingValidation), style: 5 }
      ]
    });

    return { sheetRows, merges };
  }

  return (
    <>
      <header>
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <h1>TCV Details <span>CY {year}</span></h1>
      </header>

      <main className="container detail-container">
        <button className="back-link" onClick={onBack}>Back to Dashboard</button>

        <SalesSummary wonLostSummary={filteredWonLostSummary} pendingValidationSummary={filteredPendingValidationSummary} />

        <div className="detail-filter-row">
          <label htmlFor="tcv-grouped-deal-type">Grouped Deal Type</label>
          <select id="tcv-grouped-deal-type" value={dealTypeFilter} onChange={(event) => setDealTypeFilter(event.target.value)}>
            {dealTypeOptions.map((dealType) => <option key={dealType} value={dealType}>{dealType}</option>)}
          </select>
        </div>

        {error && <p className="error">{error}</p>}

        {!combinedAccounts.length ? (
          <p className="sls-warning summary-warning">Data does not exist for the specified {entityLabel}</p>
        ) : (
          <section className="table-wrap detail-table-wrap">
            <div className="table-header">
              <h2>Account & Practice Breakdown</h2>
              <button className="export-btn" onClick={exportExcel}>Export Excel</button>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Practice</th>
                  <th>Total TCV</th>
                  <th>Won TCV</th>
                  <th>Pending Validation TCV</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map((row, index) => (
                  row.type === 'account-heading' ? (
                    <tr key={row.type + '-' + row.account + '-' + index} className="acct-row">
                      <td colSpan="5">{row.account}</td>
                    </tr>
                  ) : (
                    <tr key={row.type + '-' + row.account + '-' + (row.practice || index)} className={row.type === 'account-total' ? 'total-row' : 'detail-row'}>
                      <td>{row.type === 'account-total' ? row.account + ' - Total' : ''}</td>
                      <td>{row.type === 'practice' ? row.practice : ''}</td>
                      <td>{row.labels.total}</td>
                      <td>{row.labels.won}</td>
                      <td>{row.labels.pendingValidation}</td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </>
  );
}

function buildCombinedAccounts(wonRows, pendingRows, dealTypeFilter) {
  const details = new Map();
  wonRows.forEach((row) => {
    if (!matchesDealType(row, dealTypeFilter)) return;
    mergeDetail(details, row, { won: row.won || 0 });
  });
  pendingRows.forEach((row) => {
    if (!matchesDealType(row, dealTypeFilter)) return;
    mergeDetail(details, row, { pendingValidation: row.pendingValidation || 0 });
  });

  const accountMap = new Map();
  Array.from(details.values())
    .map((detail) => ({ ...detail, total: (detail.won || 0) + (detail.pendingValidation || 0) }))
    .filter((detail) => detail.total !== 0)
    .sort((a, b) => (a.account + a.practice).localeCompare(b.account + b.practice))
    .forEach((detail) => {
      const labeledDetail = withLabels(detail);
      const account = accountMap.get(detail.account) || {
        account: detail.account,
        total: 0,
        won: 0,
        pendingValidation: 0,
        rows: 0,
        practices: []
      };
      account.total += detail.total;
      account.won += detail.won || 0;
      account.pendingValidation += detail.pendingValidation || 0;
      account.rows += detail.rows || 0;
      account.practices.push(labeledDetail);
      accountMap.set(detail.account, account);
    });

  return Array.from(accountMap.values()).map(withLabels);
}

function mergeDetail(details, row, amounts) {
  const key = (row.account || '') + '__' + (row.practice || '');
  const detail = details.get(key) || {
    account: row.account || '',
    practice: row.practice || '',
    won: 0,
    pendingValidation: 0,
    rows: 0
  };
  detail.won += amounts.won || 0;
  detail.pendingValidation += amounts.pendingValidation || 0;
  detail.rows += row.rows || 0;
  details.set(key, detail);
}

function matchesDealType(row, dealTypeFilter) {
  const dealType = row.dealType || 'Unspecified';
  return dealTypeFilter === 'All' || dealType === dealTypeFilter;
}

function buildFilteredWonLostSummary(wonLostSummary, accounts, dealTypeFilter) {
  if (!wonLostSummary) return null;
  const totals = accounts.reduce(
    (sum, account) => ({
      total: sum.total + (account.won || 0),
      won: sum.won + (account.won || 0),
      lost: sum.lost,
      rows: sum.rows + (account.rows || 0)
    }),
    { total: 0, won: 0, lost: 0, rows: 0 }
  );

  return {
    ...wonLostSummary,
    dealTypeFilter,
    accounts,
    metrics: {
      ...wonLostSummary.metrics,
      ...totals,
      labels: {
        ...wonLostSummary.metrics?.labels,
        total: formatPipelineMoney(totals.total),
        won: formatPipelineMoney(totals.won),
        lost: formatPipelineMoney(totals.lost)
      }
    }
  };
}

function buildFilteredPendingValidationSummary(pendingValidationSummary, accounts, dealTypeFilter) {
  if (!pendingValidationSummary) return null;
  const totals = accounts.reduce(
    (sum, account) => ({
      pendingValidation: sum.pendingValidation + (account.pendingValidation || 0),
      rows: sum.rows + (account.rows || 0)
    }),
    { pendingValidation: 0, rows: 0 }
  );

  return {
    ...pendingValidationSummary,
    dealTypeFilter,
    accounts,
    metrics: {
      ...pendingValidationSummary.metrics,
      ...totals,
      labels: {
        ...pendingValidationSummary.metrics?.labels,
        pendingValidation: formatPipelineMoney(totals.pendingValidation)
      }
    }
  };
}

function withLabels(item) {
  return {
    ...item,
    labels: {
      total: formatPipelineMoney(item.total || 0),
      won: formatPipelineMoney(item.won || 0),
      pendingValidation: formatPipelineMoney(item.pendingValidation || 0)
    }
  };
}

function formatPipelineMoney(value) {
  return '$' + (value / 1000000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M';
}

function safeFileName(value) {
  return String(value || '').replace(/[^a-z0-9_-]+/gi, '_');
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
    '<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="26" customWidth="1"/><col min="3" max="5" width="22" customWidth="1"/></cols>',
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
    '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF1F3864"/><name val="Arial"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF3FA"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC5D0E0"/></left><right style="thin"><color rgb="FFC5D0E0"/></right><top style="thin"><color rgb="FFC5D0E0"/></top><bottom style="thin"><color rgb="FFC5D0E0"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotTableStyleLight16"/></styleSheet>';
}

function workbookXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="TCV" sheetId="1" r:id="rId1"/></sheets></workbook>';
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
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>TCV Export</dc:title><dc:creator>SLS Dashboard</dc:creator></cp:coreProperties>';
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
