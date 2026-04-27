import React, { useEffect, useState } from 'react';
import SalesRevenue from './sales_revenue.jsx';
import SalesRevenueDetails from './sales_revenue_details.jsx';
import SalesPipeline from './sales_pipeline.jsx';
import SalesPipelineDetails from './sales_pipeline_details.jsx';
import SalesTcvDetails from './sales_tcv_details.jsx';
import SalesSummary from './sales_summary.jsx';
import SalesWonLost from './sales_won_lost.jsx';
import SalesPendingValidation from './sales_pending_validation.jsx';

const SLSM_OPTIONS_URL = 'http://127.0.0.1:3001/api/slsm/forecast/options';
const SLSM_OPTIONS_CURRENT_URL = 'http://127.0.0.1:3001/api/slsm/forecast/options/current';
const SLSM_FORECAST_SHEET = 'SL_Forecast -2026';

function roundedMillions(value) {
  return Math.round((value / 1000000) * 10) / 10;
}

export default function SlsmSummary({ forecastWorkbook, onForecastWorkbookChange }) {
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

  useEffect(() => {
    if (forecastWorkbook) {
      loadSlsmOptionsFromWorkbook(forecastWorkbook);
      return;
    }

    loadSavedSlsmOptions();
  }, [forecastWorkbook]);

  async function loadSavedSlsmOptions() {
    setSlsmName('');
    setSlsmOptions([]);
    setOptionsError('');
    setIsLoadingOptions(true);

    try {
      const response = await fetch(SLSM_OPTIONS_CURRENT_URL);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load SLSM list.');

      setSlsmOptions(payload.options || []);
    } catch {
      setSlsmOptions([]);
    } finally {
      setIsLoadingOptions(false);
    }
  }

  async function loadSlsmOptionsFromWorkbook(file) {
    setSlsmName('');
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

      setSlsmOptions(payload.options || []);
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
                  {isRevenueLoading ? 'Running...' : 'Run Analysis'}
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
        </div>
      </main>
    </>
  );
}
