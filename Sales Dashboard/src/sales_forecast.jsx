import React from 'react';
import SalesRevenue from './sales_revenue.jsx';
import SalesPipeline from './sales_pipeline.jsx';

export default function SalesForecast() {
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
          <SalesRevenue />
          <SalesPipeline />
        </div>
      </main>
    </>
  );
}
