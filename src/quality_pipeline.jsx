import React, { useEffect, useState } from 'react';
import { apiUrl } from './api.js';
import LoadingSpinner from './loading_spinner.jsx';

const periods = ['q3', 'q4', 'year', 'yearPlus', 'total'];
const opportunityRows = Array.from({ length: 6 }, (_, index) => index + 1);

function formatMoney(value) {
  return `$${(Number(value || 0) / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}M`;
}

function Donut({ title, labels, style }) {
  return <section className="quality-donut-panel"><h3>{title}</h3><div className="quality-donut" style={{ background: style }} aria-label={title} /><div className="quality-legend">{labels.map((label, index) => <span key={label}><i className={`quality-swatch quality-swatch-${index}`} />{label}</span>)}</div></section>;
}
function OpportunityTable() {
  return <table className="quality-opportunity-table"><thead><tr><th>S.No</th><th>Account Name</th><th>Description</th><th>Total TCV</th><th>2026 TCV</th></tr></thead><tbody>{opportunityRows.map((row) => <tr key={row}><td>{row}</td><td /><td /><td /><td /></tr>)}</tbody></table>;
}
export default function QualityPipeline() {
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    async function loadSummary() {
      try {
        const response = await fetch(apiUrl('/api/quality-pipeline/summary'), { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || 'Unable to load the quality pipeline summary.');
        if (!controller.signal.aborted) setSummary(payload.available ? payload : null);
      } catch (error) {
        if (!controller.signal.aborted) setSummaryError(error.message);
      } finally {
        if (!controller.signal.aborted) setIsLoadingSummary(false);
      }
    }
    loadSummary();
    return () => controller.abort();
  }, []);

  return <><header><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5m4 5V4" /></svg><h1>Quality Pipeline</h1></header><main className="container quality-pipeline-page">{isLoadingSummary ? <LoadingSpinner label="Loading BCM and Insurance pipeline…" /> : <><h2>Quality of Pipeline</h2><table className="quality-summary"><thead><tr><th /><th>Q3</th><th>Q4</th><th>2026</th><th>2026+</th><th>Total</th></tr></thead><tbody>{['Qualified', 'Unqualified'].map((label) => { const values = summary?.rows.find((row) => row.label === label); return <tr key={label}><th>{label}</th>{periods.map((period) => <td key={period}>{values ? formatMoney(values[period]) : '—'}</td>)}</tr>; })}</tbody></table>{summaryError && <p className="quality-summary-error">{summaryError}</p>}<section className="quality-section"><h2>Pipeline Composition</h2><div className="quality-composition"><Donut title="By Offerings" labels={['Category A', 'Category B', 'Category C']} style="conic-gradient(#2f78c6 0 33%, #91bde9 33% 66%, #00869b 66% 100%)" /><Donut title="By Frontier Model" labels={['Model A', 'Model B', 'Model C']} style="conic-gradient(#2f78c6 0 33%, #91bde9 33% 66%, #00869b 66% 100%)" /><Donut title="By Campaign" labels={['GT', 'OH', 'V3']} style="conic-gradient(#2f78c6 0 33%, #91bde9 33% 66%, #00869b 66% 100%)" /></div></section><section className="quality-section quality-opportunities"><h2>Top 6 Opportunities</h2><div className="quality-opportunity-grid"><OpportunityTable /><OpportunityTable /><OpportunityTable /></div></section></>}</main></>;
}
