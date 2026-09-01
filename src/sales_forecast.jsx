import React, { useEffect, useState } from 'react';
import SalesRevenue from './sales_revenue.jsx';
import SalesRevenueDetails from './sales_revenue_details.jsx';
import SalesPipeline from './sales_pipeline.jsx';
import SalesPipelineDetails from './sales_pipeline_details.jsx';
import SalesTcvDetails from './sales_tcv_details.jsx';
import SalesSummary from './sales_summary.jsx';
import SalesWonLost from './sales_won_lost.jsx';
import SalesPendingValidation from './sales_pending_validation.jsx';
import SlsmSummary from './slsm_summary.jsx';
import SlslSummary from './slsl_summary.jsx';
import UploadTargets from './upload_targets.jsx';
import DemandCreation from './demand_creation.jsx';
import BcmiOrig from './bcmi_orig.jsx';
import QualityPipeline from './quality_pipeline.jsx';
import ReportGeneration from './report_generation.jsx';
import { apiUrl } from './api.js';

const NAV_ITEMS = [
  { id: 'slsl', label: 'SLSL' },
  { id: 'slsm', label: 'SLSM' },
  { id: 'sls', label: 'SLS' },
  { id: 'targets', label: 'Target' }
];

const REPORT_NAV_ITEMS = [
  { id: 'demand-creation', label: 'Demand Creation' },
  { id: 'bcmi-orig', label: 'BCMI - Orig' },
  { id: 'quality-pipeline', label: 'Quality Pipeline' },
  { id: 'report-generation', label: 'Report Generation' }
];

function roundedMillions(value) {
  return Math.round((value / 1000000) * 10) / 10;
}

function formatMoneyLabel(value) {
  return '$' + (value / 1000000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M';
}

export default function SalesForecast() {
  const [activeDashboard, setActiveDashboard] = useState('sls');
  const [slsName, setSlsName] = useState('');
  const [runRequestId, setRunRequestId] = useState(0);
  const [isRevenueLoading, setIsRevenueLoading] = useState(false);
  const [revenueSummary, setRevenueSummary] = useState(null);
  const [revenueResult, setRevenueResult] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [pipelineSummary, setPipelineSummary] = useState(null);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [wonLostSummary, setWonLostSummary] = useState(null);
  const [pendingValidationSummary, setPendingValidationSummary] = useState(null);
  const [targetTcvSummary, setTargetTcvSummary] = useState(null);
  const [matchedSlsNames, setMatchedSlsNames] = useState([]);
  const [pipelineUploadVersion, setPipelineUploadVersion] = useState(0);
  const [forecastWorkbook, setForecastWorkbook] = useState(null);
  const [selectedSlsmName, setSelectedSlsmName] = useState('');
  const [slsmReturnDashboard, setSlsmReturnDashboard] = useState('');
  const [slsReturnDashboard, setSlsReturnDashboard] = useState('');
  const trimmedSlsName = slsName.trim();
  const totalTcvMillions =
    roundedMillions(wonLostSummary?.metrics?.won || 0) +
    roundedMillions(pendingValidationSummary?.metrics?.pendingValidation || 0);
  const hasSummaryResult = Boolean(revenueSummary || pipelineSummary || wonLostSummary || pendingValidationSummary || targetTcvSummary);
  const hasVisibleSummary =
    (revenueSummary?.forecast || 0) !== 0 ||
    (pipelineSummary?.metrics?.pipeline || 0) !== 0 ||
    totalTcvMillions !== 0 ||
    (targetTcvSummary?.metrics?.targetTcv || 0) !== 0;
  const showNoDataWarning = trimmedSlsName && hasSummaryResult && !hasVisibleSummary;

  useEffect(() => {
    if (!trimmedSlsName) {
      setTargetTcvSummary(null);
      return undefined;
    }

    const controller = new AbortController();

    async function loadTargetTcv() {
      try {
        const response = await fetch(apiUrl(`/api/targets/accounts/current?slsName=${encodeURIComponent(trimmedSlsName)}`), {
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok || !payload.available) {
          setTargetTcvSummary(null);
          return;
        }

        const targetTcv = (payload.rows || []).reduce((total, row) => total + Number(row?.metrics?.['TCV-SPE'] || 0), 0);
        setTargetTcvSummary(
          targetTcv
            ? {
                query: trimmedSlsName,
                metrics: {
                  targetTcv,
                  labels: { targetTcv: formatMoneyLabel(targetTcv) }
                }
              }
            : null
        );
      } catch (err) {
        if (err.name !== 'AbortError') setTargetTcvSummary(null);
      }
    }

    loadTargetTcv();
    return () => controller.abort();
  }, [trimmedSlsName]);

  function handleDashboardChange(dashboard) {
    setActiveDashboard(dashboard);
    setCurrentPage('dashboard');
    setSlsmReturnDashboard('');
    setSlsReturnDashboard('');
    if (dashboard === 'slsm') {
      setSelectedSlsmName('');
    }
    if (dashboard === 'sls') {
      setSlsName('');
      clearSlsSummaryState();
    }
  }

  function handleSlsmDrilldown(slsmName) {
    setSelectedSlsmName(slsmName);
    setSlsmReturnDashboard('slsl');
    setActiveDashboard('slsm');
    setCurrentPage('dashboard');
  }

  function clearSlsSummaryState() {
    setRevenueSummary(null);
    setRevenueResult(null);
    setPipelineSummary(null);
    setPipelineResult(null);
    setWonLostSummary(null);
    setPendingValidationSummary(null);
    setTargetTcvSummary(null);
    setMatchedSlsNames([]);
  }

  function handleSlsDrilldown(slsName, sourceSlsmName = '') {
    setSlsName(slsName);
    if (sourceSlsmName) setSelectedSlsmName(sourceSlsmName);
    setSlsReturnDashboard('slsm');
    clearSlsSummaryState();
    setActiveDashboard('sls');
    setCurrentPage('dashboard');
    setRunRequestId((requestId) => requestId + 1);
  }

  function handleSlsmBack() {
    setActiveDashboard(slsmReturnDashboard || 'slsl');
    setSlsmReturnDashboard('');
    setCurrentPage('dashboard');
  }

  function handleSlsBack() {
    setActiveDashboard(slsReturnDashboard || 'slsm');
    setSlsReturnDashboard('');
    setCurrentPage('dashboard');
  }

  if (activeDashboard === 'targets') {
    return (
      <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
        <UploadTargets />
      </DashboardShell>
    );
  }

  if (activeDashboard === 'demand-creation') {
    return (
      <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
        <DemandCreation />
      </DashboardShell>
    );
  }

  if (activeDashboard === 'bcmi-orig') {
    return (
      <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
        <BcmiOrig />
      </DashboardShell>
    );
  }

  if (activeDashboard === 'quality-pipeline') {
    return (
      <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
        <QualityPipeline />
      </DashboardShell>
    );
  }

  if (activeDashboard === 'report-generation') {
    return (
      <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
        <ReportGeneration />
      </DashboardShell>
    );
  }

  if (activeDashboard === 'slsm') {
    return (
      <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
        <SlsmSummary
          forecastWorkbook={forecastWorkbook}
          onForecastWorkbookChange={setForecastWorkbook}
          selectedSlsmName={selectedSlsmName}
          onBackToSlsl={slsmReturnDashboard === 'slsl' ? handleSlsmBack : null}
          onSlsSelect={handleSlsDrilldown}
        />
      </DashboardShell>
    );
  }

  if (activeDashboard === 'slsl') {
    return (
      <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
        <SlslSummary forecastWorkbook={forecastWorkbook} onForecastWorkbookChange={setForecastWorkbook} onSlsmSelect={handleSlsmDrilldown} />
      </DashboardShell>
    );
  }

  if (currentPage === 'revenue-details') {
    return (
      <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
        <SalesRevenueDetails
          revenueResult={revenueResult}
          revenueSummary={revenueSummary}
          matchedSlsNames={matchedSlsNames}
          slsName={slsName}
          onBack={() => setCurrentPage('dashboard')}
        />
      </DashboardShell>
    );
  }

  if (currentPage === 'pipeline-details') {
    return (
      <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
        <SalesPipelineDetails
          pipelineResult={pipelineResult}
          onBack={() => setCurrentPage('dashboard')}
        />
      </DashboardShell>
    );
  }

  if (currentPage === 'tcv-details') {
    return (
      <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
        <SalesTcvDetails
          wonLostSummary={wonLostSummary}
          pendingValidationSummary={pendingValidationSummary}
          onBack={() => setCurrentPage('dashboard')}
        />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
      <header>
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
        </svg>
        <h1>SLS Dashboard <span>FY 2026</span></h1>
        {slsReturnDashboard === 'slsm' && (
          <button className="header-back-link" type="button" onClick={handleSlsBack}>
            Back to SLSM
          </button>
        )}
      </header>

      <main className="container">
        <div className="upload-grid">
          <SalesRevenue
            slsName={slsName}
            runRequestId={runRequestId}
            onLoadingChange={setIsRevenueLoading}
            onSummaryChange={setRevenueSummary}
            onMatchedNamesChange={setMatchedSlsNames}
            onResultChange={setRevenueResult}
            onWorkbookChange={setForecastWorkbook}
            externalWorkbook={forecastWorkbook}
          />
          <SalesPipeline
            slsName={slsName}
            onSummaryChange={setPipelineSummary}
            onUploadChange={() => setPipelineUploadVersion((version) => version + 1)}
            onResultChange={setPipelineResult}
          />
          <SalesWonLost slsName={slsName} uploadVersion={pipelineUploadVersion} onSummaryChange={setWonLostSummary} />
          <SalesPendingValidation slsName={slsName} uploadVersion={pipelineUploadVersion} onSummaryChange={setPendingValidationSummary} />

          <section className="search-area forecast-search">
            {!trimmedSlsName && <p className="sls-warning">Enter an SLS name to summarize pipeline.</p>}
            {showNoDataWarning && <p className="sls-warning">Data does not exist for the specified SLS</p>}
            <div className="search-row">
              <input
                type="text"
                placeholder="Enter SLS name"
                value={slsName}
                onChange={(event) => setSlsName(event.target.value)}
              />
              <button className="primary" onClick={() => setRunRequestId((requestId) => requestId + 1)} disabled={isRevenueLoading}>
                {isRevenueLoading ? <><span className="spinner button-spinner" aria-hidden="true" />Running...</> : 'Run Analysis'}
              </button>
            </div>
          </section>

          {matchedSlsNames.length > 0 && (
            <div className="chips matched-sls-chips">
              {matchedSlsNames.map((name) => <span className="chip" key={name}>{name}</span>)}
            </div>
          )}

          <SalesSummary
            revenueSummary={revenueSummary}
            pipelineSummary={pipelineSummary}
            wonLostSummary={wonLostSummary}
            pendingValidationSummary={pendingValidationSummary}
            targetTcvSummary={targetTcvSummary}
            onRevenueDetailsClick={() => setCurrentPage('revenue-details')}
            onPipelineDetailsClick={() => setCurrentPage('pipeline-details')}
            onTcvDetailsClick={() => setCurrentPage('tcv-details')}
          />
        </div>
      </main>
    </DashboardShell>
  );
}

function DashboardShell({ activeDashboard, onDashboardChange, children }) {
  const hasActiveReport = REPORT_NAV_ITEMS.some((item) => item.id === activeDashboard);
  const [isReportsMenuOpen, setIsReportsMenuOpen] = useState(hasActiveReport);

  useEffect(() => {
    if (hasActiveReport) setIsReportsMenuOpen(true);
  }, [hasActiveReport]);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Dashboard menu">
        <div className="sidebar-title">Sales</div>
        <nav className="side-nav">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={'side-nav-item' + (activeDashboard === item.id ? ' active' : '')}
              onClick={() => onDashboardChange(item.id)}
            >
              {item.label}
            </button>
          ))}
          <div className={'side-nav-group' + (hasActiveReport ? ' active' : '')}>
            <button
              type="button"
              className="side-nav-item side-nav-parent"
              aria-expanded={isReportsMenuOpen}
              aria-controls="generate-reports-menu"
              onClick={() => setIsReportsMenuOpen((isOpen) => !isOpen)}
            >
              <span>Generate Reports</span><span className="side-nav-chevron" aria-hidden="true">{isReportsMenuOpen ? '⌄' : '›'}</span>
            </button>
            {isReportsMenuOpen && (
              <div id="generate-reports-menu" className="side-nav-submenu">
                {REPORT_NAV_ITEMS.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={'side-nav-item side-nav-submenu-item' + (activeDashboard === item.id ? ' active' : '')}
                    onClick={() => onDashboardChange(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
      </aside>
      <div className="app-content">{children}</div>
    </div>
  );
}
