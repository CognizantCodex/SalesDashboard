import React, { useEffect, useState } from 'react';
import SalesRevenue from './sales_revenue.jsx';
import SalesRevenueDetails from './sales_revenue_details.jsx';
import SalesPipeline from './sales_pipeline.jsx';
import SalesPipelineDetails from './sales_pipeline_details.jsx';
import SalesTcvDetails from './sales_tcv_details.jsx';
import SalesSummary from './sales_summary.jsx';
import SalesWonLost from './sales_won_lost.jsx';
import SalesPendingValidation from './sales_pending_validation.jsx';
import { apiUrl } from './api.js';

const SLSM_OPTIONS_URL = apiUrl('/api/slsm/forecast/options');
const SLSM_OPTIONS_CURRENT_URL = apiUrl('/api/slsm/forecast/options/current');
const SLS_BREAKDOWN_URL = apiUrl('/api/slsm/sls-breakdown/current');
const SLSM_FORECAST_SHEET = 'SL_Forecast -2026';

function roundedMillions(value) {
  return Math.round((value / 1000000) * 10) / 10;
}

export default function SlsmSummary({ forecastWorkbook, onForecastWorkbookChange, selectedSlsmName = '', onBackToSlsl = null, onSlsSelect = null }) {
  const [slsmName, setSlsmName] = useState('');
  const [runRequestId, setRunRequestId] = useState(0);
  const [isRevenueLoading, setIsRevenueLoading] = useState(false);
  const [revenueSummary, setRevenueSummary] = useState(null);
  const [revenueResult, setRevenueResult] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [pipelineSummary, setPipelineSummary] = useState(null);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [wonLostSummary, setWonLostSummary] = useState(null);
  const [pendingValidationSummary, setPendingValidationSummary] = useState(null);
  const [matchedSlsmNames, setMatchedSlsmNames] = useState([]);
  const [pipelineUploadVersion, setPipelineUploadVersion] = useState(0);
  const [slsmOptions, setSlsmOptions] = useState([]);
  const [optionsError, setOptionsError] = useState('');
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [slsBreakdownRows, setSlsBreakdownRows] = useState([]);
  const [slsBreakdownError, setSlsBreakdownError] = useState('');
  const [isLoadingSlsBreakdown, setIsLoadingSlsBreakdown] = useState(false);
  const showSlsmSelector = Boolean(forecastWorkbook) || slsmOptions.length > 0 || isLoadingOptions;
  const trimmedSlsmName = slsmName.trim();
  const totalTcvMillions =
    roundedMillions(wonLostSummary?.metrics?.won || 0) +
    roundedMillions(pendingValidationSummary?.metrics?.pendingValidation || 0);
  const hasSummaryResult = Boolean(revenueSummary || pipelineSummary || wonLostSummary || pendingValidationSummary);
  const hasVisibleSummary =
    (revenueSummary?.forecast || 0) !== 0 ||
    (pipelineSummary?.metrics?.pipeline || 0) !== 0 ||
    totalTcvMillions !== 0;
  const showNoDataWarning = trimmedSlsmName && hasSummaryResult && !hasVisibleSummary;
  const slsBreakdownTotals = slsBreakdownRows.reduce(
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

  useEffect(() => {
    if (forecastWorkbook) {
      loadSlsmOptionsFromWorkbook(forecastWorkbook);
      return;
    }

    loadSavedSlsmOptions();
  }, [forecastWorkbook]);

  useEffect(() => {
    const selectedName = selectedSlsmName.trim();
    if (!selectedName || selectedName === slsmName) return;

    setSlsmName(selectedName);
    setRunRequestId((requestId) => requestId + 1);
  }, [selectedSlsmName]);

  useEffect(() => {
    if (!trimmedSlsmName) {
      setSlsBreakdownRows([]);
      setSlsBreakdownError('');
      setIsLoadingSlsBreakdown(false);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsLoadingSlsBreakdown(true);
      setSlsBreakdownError('');

      try {
        const params = new URLSearchParams({
          slsmName: trimmedSlsmName,
          currentYear: String(new Date().getFullYear())
        });
        const response = await fetch(SLS_BREAKDOWN_URL + '?' + params.toString(), { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load SLS breakdown.');

        setSlsBreakdownRows(payload.rows || []);
      } catch (err) {
        if (err.name === 'AbortError') return;
        setSlsBreakdownRows([]);
        setSlsBreakdownError(err.message);
      } finally {
        setIsLoadingSlsBreakdown(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [trimmedSlsmName, pipelineUploadVersion, revenueSummary]);

  async function loadSavedSlsmOptions() {
    if (!selectedSlsmName.trim()) setSlsmName('');
    setSlsmOptions([]);
    setOptionsError('');
    setIsLoadingOptions(true);

    try {
      const response = await fetch(SLSM_OPTIONS_CURRENT_URL);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load SLSM list.');

      const options = payload.options || [];
      setSlsmOptions(options);
      if (selectedSlsmName.trim()) setSlsmName(selectedSlsmName.trim());
    } catch {
      setSlsmOptions([]);
    } finally {
      setIsLoadingOptions(false);
    }
  }

  async function loadSlsmOptionsFromWorkbook(file) {
    if (!selectedSlsmName.trim()) setSlsmName('');
    setSlsmOptions([]);
    setOptionsError('');
    setRevenueSummary(null);
    setRevenueResult(null);
    setPipelineSummary(null);
    setPipelineResult(null);
    setWonLostSummary(null);
    setPendingValidationSummary(null);
    setMatchedSlsmNames([]);

    if (!file) return;

    setIsLoadingOptions(true);
    const formData = new FormData();
    formData.append('workbook', file);
    formData.append('sheetName', SLSM_FORECAST_SHEET);

    try {
      const response = await fetch(SLSM_OPTIONS_URL, {
        method: 'POST',
        body: formData
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to read SLSM list.');

      const options = payload.options || [];
      setSlsmOptions(options);
      if (selectedSlsmName.trim()) setSlsmName(selectedSlsmName.trim());
      if (!payload.options?.length) setOptionsError('No SLSM values found in the forecast workbook.');
    } catch (err) {
      setOptionsError(err.message);
    } finally {
      setIsLoadingOptions(false);
    }
  }

  if (currentPage === 'revenue-details') {
    return (
      <SalesRevenueDetails
        revenueResult={revenueResult}
        revenueSummary={revenueSummary}
        matchedSlsNames={matchedSlsmNames}
        slsName={slsmName}
        entityLabel="SLSM"
        onBack={() => setCurrentPage('dashboard')}
      />
    );
  }

  if (currentPage === 'pipeline-details') {
    return (
      <SalesPipelineDetails
        pipelineResult={pipelineResult}
        entityLabel="SLSM"
        onBack={() => setCurrentPage('dashboard')}
      />
    );
  }

  if (currentPage === 'tcv-details') {
    return (
      <SalesTcvDetails
        wonLostSummary={wonLostSummary}
        pendingValidationSummary={pendingValidationSummary}
        entityLabel="SLSM"
        onBack={() => setCurrentPage('dashboard')}
      />
    );
  }

  return (
    <>
      <header>
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5m4 5V4" />
        </svg>
        <h1>SLSM Summary <span>FY 2026</span></h1>
        {onBackToSlsl && (
          <button className="header-back-link" type="button" onClick={onBackToSlsl}>
            Back to SLSL
          </button>
        )}
      </header>

      <main className="container">
        <div className="upload-grid">
          <SalesRevenue
            slsName={slsmName}
            runRequestId={runRequestId}
            onLoadingChange={setIsRevenueLoading}
            onSummaryChange={setRevenueSummary}
            onMatchedNamesChange={setMatchedSlsmNames}
            onResultChange={setRevenueResult}
            onWorkbookChange={onForecastWorkbookChange}
            externalWorkbook={forecastWorkbook}
            entity="slsm"
          />
          <SalesPipeline
            slsName={slsmName}
            onSummaryChange={setPipelineSummary}
            onUploadChange={() => setPipelineUploadVersion((version) => version + 1)}
            onResultChange={setPipelineResult}
            entity="slsm"
          />
          <SalesWonLost slsName={slsmName} uploadVersion={pipelineUploadVersion} onSummaryChange={setWonLostSummary} entity="slsm" />
          <SalesPendingValidation slsName={slsmName} uploadVersion={pipelineUploadVersion} onSummaryChange={setPendingValidationSummary} entity="slsm" />

          {showSlsmSelector && (
            <section className="search-area forecast-search">
              {!trimmedSlsmName && <p className="sls-warning">Select an SLSM to summarize pipeline.</p>}
              {optionsError && <p className="upload-error dropdown-error">{optionsError}</p>}
              {showNoDataWarning && <p className="sls-warning">Data does not exist for the specified SLSM</p>}
              <div className="search-row">
                <select
                  value={slsmName}
                  onChange={(event) => setSlsmName(event.target.value)}
                  disabled={isLoadingOptions || slsmOptions.length === 0}
                >
                  <option value="">Select</option>
                  {slsmOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <button className="primary" onClick={() => setRunRequestId((requestId) => requestId + 1)} disabled={isRevenueLoading || !trimmedSlsmName}>
                  {isRevenueLoading ? <><span className="spinner button-spinner" aria-hidden="true" />Running...</> : 'Run Analysis'}
                </button>
              </div>
            </section>
          )}

          {matchedSlsmNames.length > 0 && (
            <div className="chips matched-sls-chips">
              {matchedSlsmNames.map((name) => <span className="chip" key={name}>{name}</span>)}
            </div>
          )}

          <SalesSummary
            revenueSummary={revenueSummary}
            pipelineSummary={pipelineSummary}
            wonLostSummary={wonLostSummary}
            pendingValidationSummary={pendingValidationSummary}
            onRevenueDetailsClick={() => setCurrentPage('revenue-details')}
            onPipelineDetailsClick={() => setCurrentPage('pipeline-details')}
            onTcvDetailsClick={() => setCurrentPage('tcv-details')}
          />

          {trimmedSlsmName && (
            <section className="table-wrap detail-table-wrap slsl-summary-table slsm-breakdown-table">
              <div className="table-header">
                <h2>SLS Breakdown</h2>
              </div>

              {slsBreakdownError && <p className="error">{slsBreakdownError}</p>}
              {isLoadingSlsBreakdown ? (
                <LoadingState label="Loading SLS breakdown..." />
              ) : slsBreakdownRows.length === 0 ? (
                <p className="empty-state">No SLS breakdown data is available.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>SLS</th>
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
                    {slsBreakdownRows.map((row) => (
                      <tr className="detail-row" key={row.slsName}>
                        <td>
                          <button className="table-link" type="button" onClick={() => onSlsSelect?.(row.slsName, trimmedSlsmName)}>
                            {row.slsName}
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
                      <td>{formatRevenueLabel(slsBreakdownTotals.revenue)}</td>
                      <td>{formatRevenueLabel(slsBreakdownTotals.target)}</td>
                      <td className={statusClass(gapStatus(slsBreakdownTotals.gap))}>{formatRevenueLabel(slsBreakdownTotals.gap)}</td>
                      <td>{formatDollarLabel(slsBreakdownTotals.pipeline)}</td>
                      <td>{formatDollarLabel(slsBreakdownTotals.qualified)}</td>
                      <td>{formatDollarLabel(slsBreakdownTotals.unqualified)}</td>
                      <td>{formatDollarLabel(slsBreakdownTotals.realizedTcv)}</td>
                      <td>{formatDollarLabel(slsBreakdownTotals.wonTcv)}</td>
                      <td>{formatDollarLabel(slsBreakdownTotals.pendingValidationTcv)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </section>
          )}
        </div>
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
