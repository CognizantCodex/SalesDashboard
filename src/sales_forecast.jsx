import React, { useState } from 'react';
import SalesRevenue from './sales_revenue.jsx';
import SalesPipeline from './sales_pipeline.jsx';
import SalesSummary from './sales_summary.jsx';

export default function SalesForecast() {
  const [slsName, setSlsName] = useState('');
  const [runRequestId, setRunRequestId] = useState(0);
  const [isRevenueLoading, setIsRevenueLoading] = useState(false);
  const [revenueSummary, setRevenueSummary] = useState(null);
  const [pipelineSummary, setPipelineSummary] = useState(null);

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
          />
          <SalesPipeline slsName={slsName} onSummaryChange={setPipelineSummary} />

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

          <SalesSummary revenueSummary={revenueSummary} pipelineSummary={pipelineSummary} />
        </div>
      </main>
    </>
  );
}
