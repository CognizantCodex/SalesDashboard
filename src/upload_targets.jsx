import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from './api.js';
import UploadOption from './upload_option.jsx';

const TARGET_SHEET = 'SLM-SLS-Pivot';
const VALID_WORKBOOK = /\.(xlsb|xlsx|xlsm)$/i;
const PRIORITY_METRICS = ['TCV-SPE', 'ACV-SPE', 'Rev-SPE'];

function metricLabel(row, metric) {
  return row?.labels?.[metric] ?? row?.metrics?.[metric] ?? '-';
}

function orderedMetrics(metrics) {
  return [
    ...PRIORITY_METRICS.filter((metric) => metrics.includes(metric)),
    ...metrics.filter((metric) => !PRIORITY_METRICS.includes(metric))
  ];
}

function isPercentMetric(metric) {
  return metric.toUpperCase().includes('OM %');
}

function formatTotal(metric, value) {
  if (isPercentMetric(metric)) return '-';
  return `$${(value / 1000000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
}

function totalRow(rows, metrics) {
  if (rows.length <= 1) return null;

  const labels = {};
  const values = {};
  for (const metric of metrics) {
    const metricValues = rows
      .map((row) => Number(row?.metrics?.[metric] || 0))
      .filter((value) => Number.isFinite(value));
    const total = metricValues.reduce((sum, value) => sum + value, 0);
    values[metric] = isPercentMetric(metric) ? 0 : total;
    labels[metric] = formatTotal(metric, values[metric]);
  }

  return { metrics: values, labels };
}

function TargetDataTable({ title, firstColumn, rows, metrics, onNameClick, matchedNames = [] }) {
  const displayMetrics = orderedMetrics(metrics);
  const totals = totalRow(rows, displayMetrics);

  return (
    <section className="table-wrap target-table-wrap">
      <div className="table-header">
        <h2>{title}</h2>
      </div>
      {matchedNames.length > 0 && (
        <div className="target-matched-sls">
          {matchedNames.map((name) => <span className="chip" key={name}>{name}</span>)}
        </div>
      )}
      <div className="target-table-scroll">
        <table className="target-table">
          <thead>
            <tr>
              <th>{firstColumn}</th>
              {displayMetrics.map((metric) => <th key={metric}>{metric}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const label = row.slsName || row.accountName;
              return (
                <tr key={`${label}-${row.rowNumber}`}>
                  <td>
                    {onNameClick ? (
                      <button className="table-link" type="button" onClick={() => onNameClick(row.slsName)}>
                        {row.slsName}
                      </button>
                    ) : (
                      <span className="target-account-name">{row.accountName}</span>
                    )}
                  </td>
                  {displayMetrics.map((metric) => <td key={metric}>{metricLabel(row, metric)}</td>)}
                </tr>
              );
            })}
          </tbody>
          {totals && (
            <tfoot>
              <tr>
                <td>Total</td>
                {displayMetrics.map((metric) => <td key={metric}>{metricLabel(totals, metric)}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

export default function UploadTargets() {
  const [metadata, setMetadata] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [rows, setRows] = useState([]);
  const [selectedSls, setSelectedSls] = useState('');
  const [accountRows, setAccountRows] = useState([]);
  const [matchedSlsNames, setMatchedSlsNames] = useState([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    loadTargets();
  }, []);

  const summary = useMemo(() => {
    return [
      { label: 'SLS Loaded', value: metadata?.slsCount ?? rows.length },
      { label: 'Account Rows', value: metadata?.accountCount ?? 0 },
      { label: 'Sheet', value: metadata?.sheet || TARGET_SHEET },
      { label: 'Source', value: metadata?.sourceFilename || 'No file uploaded' }
    ];
  }, [metadata, rows.length]);

  async function loadTargets() {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(apiUrl('/api/targets/current'));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to load targets.');
      setMetadata(payload.database || null);
      setMetrics(payload.metrics || []);
      setRows(payload.rows || []);
      if (!payload.available) {
        setSelectedSls('');
        setAccountRows([]);
        setMatchedSlsNames([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadAccounts(slsName) {
    setSelectedSls(slsName);
    setAccountRows([]);
    setMatchedSlsNames([]);
    setError('');
    try {
      const response = await fetch(apiUrl(`/api/targets/accounts/current?slsName=${encodeURIComponent(slsName)}`));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to load target accounts.');
      setAccountRows(payload.rows || []);
      setMatchedSlsNames(payload.matchedSlsNames || []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleFileSelect(file) {
    setError('');
    if (!file) return;
    if (!VALID_WORKBOOK.test(file.name)) {
      setError('Please select a .xlsb, .xlsx, or .xlsm workbook.');
      return;
    }

    const form = new FormData();
    form.append('workbook', file);
    form.append('sheetName', TARGET_SHEET);
    setIsUploading(true);
    try {
      const response = await fetch(apiUrl('/api/targets/upload'), {
        method: 'POST',
        body: form
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to upload targets.');
      setMetadata(payload.database || null);
      setMetrics(payload.metrics || []);
      setRows(payload.rows || []);
      setSelectedSls('');
      setAccountRows([]);
      setMatchedSlsNames([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <>
      <header>
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5m4 5V4" />
        </svg>
        <h1>Upload Targets <span>FY 2026</span></h1>
      </header>

      <main className="container targets-page">
        <UploadOption
          className="targets-upload"
          label="Targets"
          title={metadata?.sourceFilename ? metadata.sourceFilename : 'Drop your targets workbook here'}
          subtitle={metadata?.available ? 'Upload again to replace the current target data' : `Uses sheet ${TARGET_SHEET}`}
          icon="pipeline"
          error={error}
          isComplete={Boolean(metadata?.available)}
          onFileSelect={handleFileSelect}
        />

        {(isLoading || isUploading) && (
          <div className="targets-loading">
            <span className="spinner" aria-hidden="true" />
            <span>{isUploading ? 'Uploading targets...' : 'Loading targets...'}</span>
          </div>
        )}

        <section className="target-summary-grid" aria-label="Target upload summary">
          {summary.map((item) => (
            <div className="target-summary-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </section>

        {rows.length > 0 ? (
          <TargetDataTable
            title="SLS Target Summary"
            firstColumn="SLS"
            rows={rows}
            metrics={metrics}
            onNameClick={loadAccounts}
          />
        ) : (
          !isLoading && <p className="targets-empty">Upload a targets workbook to load SLS target data.</p>
        )}

        {selectedSls && (
          <TargetDataTable
            title={`${selectedSls} Accounts`}
            firstColumn="Account"
            rows={accountRows}
            metrics={metrics}
            matchedNames={matchedSlsNames}
          />
        )}
      </main>
    </>
  );
}
