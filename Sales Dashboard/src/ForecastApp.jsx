import React, { useEffect, useMemo, useState } from 'react';

const AGENT_URL = 'http://127.0.0.1:3001/api/forecast/analyze';
const CURRENT_URL = 'http://127.0.0.1:3001/api/forecast/current';
const EXPORT_URL = 'http://127.0.0.1:3001/api/forecast/export.csv';

export default function ForecastApp() {
  const [workbook, setWorkbook] = useState(null);
  const [slsName, setSlsName] = useState('Saxena, Gaurav');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

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

  useEffect(() => {
    loadStoredForecast(slsName, { silent: true });
  }, []);

  async function loadStoredForecast(name = slsName, options = {}) {
    if (!options.silent) setLoading(true);
    setError('');

    try {
      const url = `${CURRENT_URL}?slsName=${encodeURIComponent(name)}`;
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load saved forecast.');

      if (payload.available) {
        setResult(payload);
      } else if (!options.silent) {
        setResult(null);
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

    const formData = new FormData();
    formData.append('workbook', workbook);
    formData.append('slsName', slsName);

    try {
      const response = await fetch(AGENT_URL, {
        method: 'POST',
        body: formData
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Forecast agent failed.');
      setResult(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    if (!workbook && result?.rows?.length) {
      exportRowsFromState();
      return;
    }
    if (!workbook) return;

    const formData = new FormData();
    formData.append('workbook', workbook);
    formData.append('slsName', slsName);

    const response = await fetch(EXPORT_URL, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.detail || 'CSV export failed.');
      return;
    }

    const blob = await response.blob();
    downloadBlob(blob, `${slsName || 'SLS'}_Forecast_2026.csv`);
  }

  function exportRowsFromState() {
    const lines = [['Account', 'Practice', 'Forecast_$K', 'Target_$K', 'Gap_$K']];
    result.rows.forEach((row) => {
      lines.push([row.account, row.practice, row.forecast.toFixed(2), row.target.toFixed(2), row.gap.toFixed(2)]);
    });
    const csv = lines.map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${slsName || 'SLS'}_Forecast_2026.csv`);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    const allowed = /\.(xlsb|xlsx|xlsm)$/i.test(file.name);
    if (!allowed) {
      setError('Please drop a .xlsb, .xlsx, or .xlsm workbook.');
      return;
    }

    setWorkbook(file);
    setError('');
    setResult(null);
  }

  return (
    <>
      <header>
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
        </svg>
        <h1>SLS Dashboard <span>FY 2026</span></h1>
      </header>

      <main className="container">
        <section
          className={`upload-card${workbook ? ' done' : ''}${isDragging ? ' drag' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <label>
            <svg className="upload-icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16V8m0 0-3 3m3-3 3 3M20 16.5A3.5 3.5 0 0 0 16.5 13H15a5 5 0 1 0-9.9 1.5" />
            </svg>
            <p className="upload-title">{workbook ? workbook.name : result?.database?.sourceFilename || 'Drop your workbook here'}</p>
            <p className="upload-sub">
              {workbook
                ? 'Workbook selected - ready to analyse'
                : result?.database?.rowsSaved
                  ? `${result.database.rowsSaved.toLocaleString()} rows loaded from saved revenue_forecast data`
                  : 'Supports .xlsb and .xlsx - processed by the Python agent'}
            </p>
            <input
              type="file"
              accept=".xlsb,.xlsx,.xlsm"
              onChange={(event) => {
                setWorkbook(event.target.files?.[0] || null);
                setError('');
                setResult(null);
              }}
            />
          </label>
        </section>

        <section className="search-area">
          {result?.matchedSlsNames?.length > 0 && (
            <div className="chips">
              {result.matchedSlsNames.map((name) => <span className="chip" key={name}>{name}</span>)}
            </div>
          )}
          <div className="search-row">
            <input
              type="text"
              placeholder="Enter SLS name  e.g. Saxena, Gaurav"
              value={slsName}
              onChange={(event) => setSlsName(event.target.value)}
            />
          <button className="primary" onClick={runAgent} disabled={loading}>
            {loading ? 'Running...' : 'Run Analysis'}
          </button>
        </div>
        </section>

        {error && <p className="error">{error}</p>}

        {!result && !error && (
          <div className="empty-state">
            Upload your forecast workbook and run the agent to see account and practice gaps.
          </div>
        )}

        {result && (
          <>
            <section className="metrics">
              <Metric label="Forecast" value={result.metrics.labels.forecast} />
              <Metric label="Target" value={result.metrics.labels.target} />
              <Metric label="Gap" value={result.metrics.labels.gap} tone={result.metrics.status} />
              <Metric label="Accounts" value={result.metrics.accounts} />
            </section>

            <section className="table-wrap">
              <div className="table-header">
                <h2>{result.query} - Account & Practice Breakdown</h2>
                <button className="export-btn" onClick={exportCsv}>Export CSV</button>
              </div>

                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Practice</th>
                      <th>Forecast<br /><span>SL_FY'26</span></th>
                      <th>Target<br /><span>Target-2026</span></th>
                      <th>Gap<br /><span>FY'26-Gap SL</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountRows.map((row, index) => (
                      row.type === 'account-heading' ? (
                        <tr key={`${row.type}-${row.account}-${index}`} className="acct-row">
                          <td colSpan="5">{row.account}</td>
                        </tr>
                      ) : (
                        <tr key={`${row.type}-${row.account}-${row.practice || index}`} className={row.type === 'account-total' ? 'total-row' : 'detail-row'}>
                          <td>{row.type === 'account-total' ? `${row.account} - Total` : ''}</td>
                          <td>{row.type === 'practice' ? row.practice : ''}</td>
                          <td>{row.labels.forecast}</td>
                          <td>{row.labels.target}</td>
                          <td className={statusClass(row.status)}>{row.labels.gap}</td>
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function Metric({ label, value, tone = '' }) {
  return (
    <article className="metric">
      <div className="metric-label">{label}</div>
      <div className={`metric-val ${statusClass(tone)}`}>{value}</div>
    </article>
  );
}

function statusClass(status) {
  if (status === 'behind') return 'red';
  if (status === 'ahead') return 'green';
  return 'muted';
}
