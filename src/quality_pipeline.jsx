import React, { useEffect, useState } from 'react';
import { apiUrl } from './api.js';
import LoadingSpinner from './loading_spinner.jsx';

const periods = ['q3', 'q4', 'year', 'yearPlus', 'total'];
const opportunityRows = Array.from({ length: 6 }, (_, index) => index + 1);
const offeringColors = ['#2f78c6', '#91bde9', '#00869b'];

function formatMoney(value) {
  return `$${(Number(value || 0) / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}M`;
}

function Donut({ title, labels, style }) {
  return <section className="quality-donut-panel"><h3>{title}</h3><div className="quality-donut" style={{ background: style }} aria-label={title} /><div className="quality-legend">{labels.map((label, index) => <span key={label}><i className={`quality-swatch quality-swatch-${index}`} />{label}</span>)}</div></section>;
}
function PlaceholderDonut({ title }) {
  return <Donut title={title} labels={['No data loaded']} style="#e1e5e9" />;
}
function OpportunityTable({ opportunities }) {
  return <table className="quality-opportunity-table"><thead><tr><th>S.No</th><th>Account Name</th><th>Description</th><th>Total<br />TCV</th><th>2026 TCV</th></tr></thead><tbody>{opportunityRows.map((row, index) => { const opportunity = opportunities[index]; return <tr key={row}><td>{row}</td><td>{opportunity?.account || ''}</td><td>{opportunity?.description || ''}</td><td>{opportunity ? formatMoney(opportunity.totalTcv) : ''}</td><td>{opportunity ? formatMoney(opportunity.yearTcv) : ''}</td></tr>; })}</tbody></table>;
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

  const offerings = summary?.offerings || [];
  const opportunityList = summary?.opportunities || [];
  const campaigns = summary?.campaigns || [];
  const campaignOpportunityList = summary?.campaignOpportunities || [];
  const donutLabels = (categories) => categories.map((category) => `${category.name} (${category.percent.toFixed(0)}%)`);
  const donutStyle = (categories) => categories.length ? `conic-gradient(${categories.map((category, index) => { const start = categories.slice(0, index).reduce((total, item) => total + item.percent, 0); return `${offeringColors[index]} ${start}% ${start + category.percent}%`; }).join(', ')})` : '#e1e5e9';
  const offeringLabels = donutLabels(offerings);
  const campaignLabels = donutLabels(campaigns);
  const offeringStyle = donutStyle(offerings);
  const campaignStyle = donutStyle(campaigns);

  return <><header><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5m4 5V4" /></svg><h1>Quality Pipeline</h1></header><main className="container quality-pipeline-page">{isLoadingSummary ? <LoadingSpinner label="Loading BCM and Insurance pipeline…" /> : <><h2>Quality of Pipeline</h2><table className="quality-summary"><thead><tr><th /><th>Q3</th><th>Q4</th><th>2026</th><th>2026+</th><th>Total</th></tr></thead><tbody>{['Qualified', 'Unqualified'].map((label) => { const values = summary?.rows.find((row) => row.label === label); return <tr key={label}><th>{label}</th>{periods.map((period) => <td key={period}>{values ? formatMoney(values[period]) : '—'}</td>)}</tr>; })}</tbody></table>{summaryError && <p className="quality-summary-error">{summaryError}</p>}<section className="quality-section"><h2>Pipeline Composition</h2><div className="quality-composition"><Donut title="By Offerings" labels={offeringLabels} style={offeringStyle} /><PlaceholderDonut title="By Frontier Model" /><Donut title="By Campaign" labels={campaignLabels} style={campaignStyle} /></div></section><section className="quality-section quality-opportunities"><h2>Top 6 Opportunities</h2><div className="quality-opportunity-grid"><div className="quality-opportunity-panel"><h3>Across Top Offerings</h3><OpportunityTable opportunities={opportunityList} /></div><div className="quality-opportunity-panel"><h3>Across Top Campaign Themes</h3><OpportunityTable opportunities={campaignOpportunityList} /></div></div></section></>}</main></>;
}
