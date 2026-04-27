import React, { useState } from 'react';
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

const NAV_ITEMS = [
  { id: 'slsl', label: 'SLSL' },
  { id: 'slsm', label: 'SLSM' },
  { id: 'sls', label: 'SLS' }
];

function roundedMillions(value) {
  return Math.round((value / 1000000) * 10) / 10;
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
  const [matchedSlsNames, setMatchedSlsNames] = useState([]);
  const [pipelineUploadVersion, setPipelineUploadVersion] = useState(0);
  const [forecastWorkbook, setForecastWorkbook] = useState(null);
  const [selectedSlsmName, setSelectedSlsmName] = useState('');
  const [slsmReturnDashboard, setSlsmReturnDashboard] = useState('');
  const trimmedSlsName = slsName.trim();
  const totalTcvMillions =
    roundedMillions(wonLostSummary?.metrics?.won || 0) +
    roundedMillions(pendingValidationSummary?.metrics?.pendingValidation || 0);
  const hasSummaryResult = Boolean(revenueSummary || pipelineSummary || wonLostSummary || pendingValidationSummary);
  const hasVisibleSummary =
    (revenueSummary?.forecast || 0) !== 0 ||
    (pipelineSummary?.metrics?.pipeline || 0) !== 0 ||
    totalTcvMillions !== 0;
  const showNoDataWarning = trimmedSlsName && hasSummaryResult && !hasVisibleSummary;

  function handleDashboardChange(dashboard) {
    setActiveDashboard(dashboard);
    setCurrentPage('dashboard');
    setSlsmReturnDashboard('');
  }

  function handleSlsmDrilldown(slsmName) {
    setSelectedSlsmName(slsmName);
    setSlsmReturnDashboard('slsl');
    setActiveDashboard('slsm');
    setCurrentPage('dashboard');
  }

  function handleSlsmBack() {
    setActiveDashboard(slsmReturnDashboard || 'slsl');
    setSlsmReturnDashboard('');
    setCurrentPage('dashboard');
  }

  if (activeDashboard === 'slsm') {
    return (
      <DashboardShell activeDashboard={activeDashboard} onDashboardChange={handleDashboardChange}>
        <SlsmSummary
          forecastWorkbook={forecastWorkbook}
          onForecastWorkbookChange={setForecastWorkbook}
          selectedSlsmName={selectedSlsmName}
          onBackToSlsl={slsmReturnDashboard === 'slsl' ? handleSlsmBack : null}
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
        </nav>
      </aside>
      <div className="app-content">{children}</div>
    </div>
  );
}
