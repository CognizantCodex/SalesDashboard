import React, { useEffect, useState } from 'react';
import { apiUrl } from './api.js';
import UploadOption from './upload_option.jsx';

const WORKBOOK_PATTERN = /\.(xlsb|xlsx|xlsm)$/i;
const REVENUE_METADATA_URL = apiUrl('/api/forecast/current/metadata');
const PIPELINE_METADATA_URL = apiUrl('/api/pipeline/upload/metadata');
const INSURANCE_PIPELINE_METADATA_URL = apiUrl('/api/pipeline/insurance/upload/metadata');
const PIPELINE_UPLOAD_URL = apiUrl('/api/pipeline/upload');
const INSURANCE_PIPELINE_UPLOAD_URL = apiUrl('/api/pipeline/insurance/upload');
const SLSL_SUMMARY_URL = apiUrl('/api/slsl/summary/current');

export default function SlslSummary({ forecastWorkbook, onForecastWorkbookChange, onSlsmSelect }) {
  const [pipelineWorkbook, setPipelineWorkbook] = useState(null);
  const [insurancePipelineWorkbook, setInsurancePipelineWorkbook] = useState(null);
  const [savedRevenue, setSavedRevenue] = useState(null);
  const [savedPipeline, setSavedPipeline] = useState(null);
  const [savedInsurancePipeline, setSavedInsurancePipeline] = useState(null);
  const [summaryRows, setSummaryRows] = useState([]);
  const [summaryError, setSummaryError] = useState('');
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [revenueError, setRevenueError] = useState('');
  const [pipelineError, setPipelineError] = useState('');
  const [insurancePipelineError, setInsurancePipelineError] = useState('');
  const [pipelineUploadVersion, setPipelineUploadVersion] = useState(0);

  useEffect(() => {
    setRevenueError('');
  }, [forecastWorkbook]);

  useEffect(() => {
    let ignore = false;

    async function loadSavedUploads() {
      try {
        const [revenueResponse, pipelineResponse, insurancePipelineResponse] = await Promise.all([
          fetch(REVENUE_METADATA_URL),
          fetch(PIPELINE_METADATA_URL),
          fetch(INSURANCE_PIPELINE_METADATA_URL)
        ]);
        const [revenuePayload, pipelinePayload, insurancePipelinePayload] = await Promise.all([
          revenueResponse.json(),
          pipelineResponse.json(),
          insurancePipelineResponse.json()
        ]);

        if (!ignore) {
          setSavedRevenue(revenueResponse.ok && revenuePayload.available ? revenuePayload.database : null);
          setSavedPipeline(pipelineResponse.ok && pipelinePayload.available ? pipelinePayload.database : null);
          setSavedInsurancePipeline(insurancePipelineResponse.ok && insurancePipelinePayload.available ? insurancePipelinePayload.database : null);
        }
      } catch {
        if (!ignore) {
          setSavedRevenue(null);
          setSavedPipeline(null);
          setSavedInsurancePipeline(null);
        }
      }
    }

    loadSavedUploads();
    return () => {
      ignore = true;
    };
  }, [pipelineUploadVersion]);

  useEffect(() => {
    let ignore = false;

    async function loadSlslSummary() {
      setIsLoadingSummary(true);
      setSummaryError('');

      try {
        const params = new URLSearchParams({
          currentYear: String(new Date().getFullYear())
        });
        const response = await fetch(SLSL_SUMMARY_URL + '?' + params.toString());
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load SLSL summary.');

        if (!ignore) setSummaryRows(payload.rows || []);
      } catch (err) {
        if (!ignore) {
          setSummaryRows([]);
          setSummaryError(err.message);
        }
      } finally {
        if (!ignore) setIsLoadingSummary(false);
      }
    }

    loadSlslSummary();
    return () => {
      ignore = true;
    };
  }, [pipelineUploadVersion]);

  function selectRevenueWorkbook(file, source = 'select') {
    if (!file) {
      onForecastWorkbookChange?.(null);
      setRevenueError('');
      return;
    }

    if (!WORKBOOK_PATTERN.test(file.name)) {
      onForecastWorkbookChange?.(null);
      setRevenueError('Please ' + (source === 'drop' ? 'drop' : 'select') + ' a .xlsb, .xlsx, or .xlsm workbook.');
      return;
    }

    onForecastWorkbookChange?.(file);
    setSavedRevenue(null);
    setRevenueError('');
  }

  async function uploadPipelineWorkbook(file, url) {
    const formData = new FormData();
    formData.append('workbook', file);
    formData.append('sheetName', 'Data');
    const response = await fetch(url, { method: 'POST', body: formData });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || 'Pipeline upload failed.');
    return payload.database;
  }

  async function selectPipelineWorkbook(file, source = 'select') {
    if (!file) {
      setPipelineWorkbook(null);
      setPipelineError('');
      return;
    }

    if (!WORKBOOK_PATTERN.test(file.name)) {
      setPipelineWorkbook(null);
      setPipelineError('Please ' + (source === 'drop' ? 'drop' : 'select') + ' a .xlsb, .xlsx, or .xlsm workbook.');
      return;
    }

    setPipelineError('');
    try {
      const database = await uploadPipelineWorkbook(file, PIPELINE_UPLOAD_URL);
      setPipelineWorkbook(file);
      setSavedPipeline(database);
      setPipelineUploadVersion((version) => version + 1);
    } catch (err) {
      setPipelineWorkbook(null);
      setPipelineError(err.message);
    }
  }

  async function selectInsurancePipelineWorkbook(file, source = 'select') {
    if (!file) {
      setInsurancePipelineWorkbook(null);
      setInsurancePipelineError('');
      return;
    }

    if (!WORKBOOK_PATTERN.test(file.name)) {
      setInsurancePipelineWorkbook(null);
      setInsurancePipelineError('Please ' + (source === 'drop' ? 'drop' : 'select') + ' an Insurance .xlsb, .xlsx, or .xlsm workbook.');
      return;
    }

    setInsurancePipelineError('');
    try {
      const database = await uploadPipelineWorkbook(file, INSURANCE_PIPELINE_UPLOAD_URL);
      setInsurancePipelineWorkbook(file);
      setSavedInsurancePipeline(database);
      setPipelineUploadVersion((version) => version + 1);
    } catch (err) {
      setInsurancePipelineWorkbook(null);
      setInsurancePipelineError(err.message);
    }
  }

  const revenueTitle = forecastWorkbook
    ? forecastWorkbook.name
    : savedRevenue?.sourceFilename || 'Drop your revenue workbook here';
  const revenueSubtitle = forecastWorkbook
    ? 'Revenue workbook selected'
    : savedRevenue?.rowsSaved
      ? savedRevenue.rowsSaved.toLocaleString() + ' rows loaded from saved revenue data'
      : 'Supports .xlsb and .xlsx';
  const pipelineTitle = pipelineWorkbook
    ? pipelineWorkbook.name
    : savedPipeline?.sourceFilename || 'Drop your pipeline workbook here';
  const pipelineSubtitle = pipelineWorkbook
    ? 'Pipeline workbook selected'
    : savedPipeline?.rowsSaved
      ? savedPipeline.rowsSaved.toLocaleString() + ' rows loaded from saved pipeline data'
      : 'Supports .xlsb and .xlsx';
  const insurancePipelineTitle = insurancePipelineWorkbook
    ? insurancePipelineWorkbook.name
    : savedInsurancePipeline?.sourceFilename || 'Drop your Insurance pipeline workbook here';
  const insurancePipelineSubtitle = insurancePipelineWorkbook
    ? 'Insurance workbook uploaded and merged'
    : savedInsurancePipeline?.rowsSaved
      ? savedInsurancePipeline.rowsSaved.toLocaleString() + ' Insurance rows merged with pipeline data'
      : 'Supports .xlsb and .xlsx';
  const totals = summaryRows.reduce(
    (accumulator, row) => {
      accumulator.revenue += row.revenue.forecast || 0;
      accumulator.target += row.revenue.target || 0;
      accumulator.gap += row.revenue.gap || 0;
      accumulator.pipeline += row.pipeline.pipeline || 0;
      accumulator.qualified += row.pipeline.qualified || 0;
      accumulator.unqualified += row.pipeline.unqualified || 0;
      accumulator.realizedTcv += row.realizedTcv.total || 0;
      accumulator.wonTcv += row.realizedTcv.won || 0;
      accumulator.pendingValidationTcv += row.realizedTcv.pendingValidation || 0;
      return accumulator;
    },
    { revenue: 0, target: 0, gap: 0, pipeline: 0, qualified: 0, unqualified: 0, realizedTcv: 0, wonTcv: 0, pendingValidationTcv: 0 }
  );
  const hasSummaryRows = summaryRows.length > 0;

  return (
    <>
      <header>
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16M4 12h12M4 18h8" />
        </svg>
        <h1>SLSL Summary <span>FY 2026</span></h1>
      </header>

      <main className="container">
        <div className="upload-grid">
          <UploadOption
            className="revenue-upload"
            label="Revenue"
            title={revenueTitle}
            subtitle={revenueSubtitle}
            error={revenueError}
            icon="revenue"
            isComplete={Boolean(forecastWorkbook || savedRevenue?.rowsSaved)}
            onFileSelect={selectRevenueWorkbook}
          />
          <UploadOption
            className="pipeline-upload"
            label="Pipeline"
            title={pipelineTitle}
            subtitle={pipelineSubtitle}
            error={pipelineError}
            icon="pipeline"
            isComplete={Boolean(pipelineWorkbook || savedPipeline?.rowsSaved)}
            onFileSelect={selectPipelineWorkbook}
          />
          <UploadOption
            className="pipeline-upload insurance-pipeline-upload"
            label="Insurance Pipeline"
            title={insurancePipelineTitle}
            subtitle={insurancePipelineSubtitle}
            error={insurancePipelineError}
            icon="pipeline"
            isComplete={Boolean(insurancePipelineWorkbook || savedInsurancePipeline?.rowsSaved)}
            onFileSelect={selectInsurancePipelineWorkbook}
          />
        </div>

        {hasSummaryRows && (
          <section className="summary-panel slsl-total-summary">
            <section className="summary-group">
              <h2>Revenue Summary</h2>
              <div className="summary-grid">
                <Metric label="Forecast" value={formatRevenueLabel(totals.revenue)} />
                <Metric label="Target" value={formatRevenueLabel(totals.target)} />
                <Metric label="Gap" value={formatRevenueLabel(totals.gap)} tone={gapStatus(totals.gap)} />
              </div>
            </section>

            <section className="summary-group">
              <h2>Pipeline Summary</h2>
              <div className="summary-grid">
                <Metric label="Total Pipeline" value={formatDollarLabel(totals.pipeline)} />
                <Metric label="Qualified" value={formatDollarLabel(totals.qualified)} />
                <Metric label="Un-Qualified" value={formatDollarLabel(totals.unqualified)} />
              </div>
            </section>

            <section className="summary-group">
              <h2>Realized TCV Summary</h2>
              <div className="summary-grid">
                <Metric label="Total TCV" value={formatDollarLabel(totals.realizedTcv)} />
                <Metric label="Won" value={formatDollarLabel(totals.wonTcv)} />
                <Metric label="Pending Validation" value={formatDollarLabel(totals.pendingValidationTcv)} />
              </div>
            </section>
          </section>
        )}

        <section className="table-wrap detail-table-wrap slsl-summary-table">
          <div className="table-header">
            <h2>SLSM Breakdown</h2>
          </div>

          {summaryError && <p className="error">{summaryError}</p>}
          {isLoadingSummary ? (
            <LoadingState label="Loading SLSM summary..." />
          ) : summaryRows.length === 0 ? (
            <p className="empty-state">No SLSM summary data is available.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>SLSM</th>
                  <th>Revenue</th>
                  <th>Target</th>
                  <th>Gap</th>
                  <th>Pipeline</th>
                  <th>Qualified</th>
                  <th>Un-Qualified</th>
                  <th>TCV</th>
                  <th>Won</th>
                  <th>Pending Validation</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((row) => (
                  <tr className="detail-row" key={row.slsmName}>
                    <td>
                      <button className="table-link" type="button" onClick={() => onSlsmSelect?.(row.slsmName)}>
                        {row.slsmName}
                      </button>
                    </td>
                    <td>{row.revenue.labels.forecast}</td>
                    <td>{row.revenue.labels.target}</td>
                    <td className={statusClass(row.revenue.status)}>{row.revenue.labels.gap}</td>
                    <td>{row.pipeline.labels.pipeline}</td>
                    <td>{row.pipeline.labels.qualified}</td>
                    <td>{row.pipeline.labels.unqualified}</td>
                    <td>{row.realizedTcv.labels.total}</td>
                    <td>{row.realizedTcv.labels.won}</td>
                    <td>{row.realizedTcv.labels.pendingValidation}</td>
                  </tr>
                ))}
                <tr className="total-row slsl-total-row">
                  <td>Total</td>
                  <td>{formatRevenueLabel(totals.revenue)}</td>
                  <td>{formatRevenueLabel(totals.target)}</td>
                  <td className={statusClass(gapStatus(totals.gap))}>{formatRevenueLabel(totals.gap)}</td>
                  <td>{formatDollarLabel(totals.pipeline)}</td>
                  <td>{formatDollarLabel(totals.qualified)}</td>
                  <td>{formatDollarLabel(totals.unqualified)}</td>
                  <td>{formatDollarLabel(totals.realizedTcv)}</td>
                  <td>{formatDollarLabel(totals.wonTcv)}</td>
                  <td>{formatDollarLabel(totals.pendingValidationTcv)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}

function statusClass(status) {
  if (status === 'behind') return 'red';
  if (status === 'ahead') return 'green';
  return 'muted';
}

function LoadingState({ label }) {
  return (
    <p className="empty-state loading-state">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

function Metric({ label, value, tone = '' }) {
  return (
    <article className="metric">
      <div className="metric-label">{label}</div>
      <div className={'metric-val ' + statusClass(tone)}>{value}</div>
    </article>
  );
}

function formatRevenueLabel(value) {
  return '$' + (value / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M';
}

function formatDollarLabel(value) {
  return '$' + (value / 1000000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M';
}

function gapStatus(value) {
  const gapInMillions = value / 1000;
  if (gapInMillions > 0.05) return 'behind';
  if (gapInMillions < -0.05) return 'ahead';
  return 'on-track';
}
