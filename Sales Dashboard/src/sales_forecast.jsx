import React, { useState } from 'react';
import SalesRevenue from './sales_revenue.jsx';
import SalesRevenueDetails from './sales_revenue_details.jsx';
import SalesPipeline from './sales_pipeline.jsx';
import SalesSummary from './sales_summary.jsx';
import SalesWonLost from './sales_won_lost.jsx';
import SalesPendingValidation from './sales_pending_validation.jsx';

export default function SalesForecast() {
  const [slsName, setSlsName] = useState('');
  const [runRequestId, setRunRequestId] = useState(0);
  const [isRevenueLoading, setIsRevenueLoading] = useState(false);
  const [revenueSummary, setRevenueSummary] = useState(null);
  const [revenueResult, setRevenueResult] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [pipelineSummary, setPipelineSummary] = useState(null);
  const [wonLostSummary, setWonLostSummary] = useState(null);
  const [pendingValidationSummary, setPendingValidationSummary] = useState(null);
  const [matchedSlsNames, setMatchedSlsNames] = useState([]);
  const [pipelineUploadVersion, setPipelineUploadVersion] = useState(0);

  if (currentPage === 'revenue-details') {
    return (
      <SalesRevenueDetails
        revenueResult={revenueResult}
        revenueSummary={revenueSummary}
        matchedSlsNames={matchedSlsNames}
        slsName={slsName}
        onBack={() => setCurrentPage('dashboard')}
      />
    );
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
        <div className="upload-grid">
          <SalesRevenue
            slsName={slsName}
            runRequestId={runRequestId}
            onLoadingChange={setIsRevenueLoading}
            onSummaryChange={setRevenueSummary}
            onMatchedNamesChange={setMatchedSlsNames}
            onResultChange={setRevenueResult}
          />
          <SalesPipeline
            slsName={slsName}
            onSummaryChange={setPipelineSummary}
            onUploadChange={() => setPipelineUploadVersion((version) => version + 1)}
          />
          <SalesWonLost slsName={slsName} uploadVersion={pipelineUploadVersion} onSummaryChange={setWonLostSummary} />
          <SalesPendingValidation slsName={slsName} uploadVersion={pipelineUploadVersion} onSummaryChange={setPendingValidationSummary} />

          <section className="search-area forecast-search">
            {!slsName.trim() && <p className="sls-warning">Enter an SLS name to summarize pipeline.</p>}
            <div className="search-row">
              <input
                type="text"
                placeholder="Enter SLS name"
                value={slsName}
                onChange={(event) => setSlsName(event.target.value)}
              />
              <button className="primary" onClick={() => setRunRequestId((requestId) => requestId + 1)} disabled={isRevenueLoading}>
                {isRevenueLoading ? 'Running...' : 'Run Analysis'}
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
          />
        </div>
      </main>
    </>
  );
}
