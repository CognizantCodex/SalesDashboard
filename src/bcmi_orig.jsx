import React, { useEffect, useState } from 'react';
import { apiUrl } from './api.js';
import LoadingSpinner from './loading_spinner.jsx';

const periods = ['Aug', 'Q3', 'Q4'];
const ranks = Array.from({ length: 10 }, (_, index) => index + 1);

function OpportunityPanel({ period }) {
  return <section className="bcmi-orig-opportunity"><h2>{period}</h2><dl><div><dt>GAP</dt><dd>xx</dd></div><div><dt>Total Opportunity Size</dt><dd>xx</dd></div></dl><p>Top 10 Opportunities</p><table><thead><tr><th>#</th><th>Act Name</th><th>Description</th><th>Total</th></tr></thead><tbody>{ranks.map((rank) => <tr key={rank}><td>{rank}</td><td>{rank === 1 ? 'JPMC' : ''}</td><td /><td /></tr>)}</tbody></table></section>;
}
function CompactTable({ title, headers, rows, amount }) {
  return <section className={'bcmi-orig-compact' + (title === 'Revenue Erosion' ? ' bcmi-orig-erosion' : '')}><div className="bcmi-orig-compact-title"><h2>{title}</h2><strong>{amount}</strong></div><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => { const cells = typeof row === 'object' ? [rowIndex + 1, row.account, row.description, row.netTcv, row.cyRevenue] : [row]; return <tr key={typeof row === 'object' ? `${row.account}-${row.description}-${rowIndex}` : row}><td>{cells[0]}</td>{headers.slice(1).map((_, index) => <td key={index}>{cells[index + 1] || ''}</td>)}</tr>; })}</tbody></table></section>;
}

function formatRevenue(value) {
  return `$${(Number(value || 0) / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
}

function formatRa(value) {
  return `$${(Number(value || 0) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
}

export default function BcmiOrig() {
  const [revenueSummary, setRevenueSummary] = useState(null);
  const [raSummary, setRaSummary] = useState(null);
  const [biweeklyWins, setBiweeklyWins] = useState(null);
  const [isLoadingRevenue, setIsLoadingRevenue] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    async function loadRevenueSummary() {
      try {
        const [revenueResponse, raResponse, winsResponse] = await Promise.all([
          fetch(apiUrl('/api/bcmi-orig/revenue-summary'), { signal: controller.signal }),
          fetch(apiUrl('/api/bcmi-orig/ra-summary'), { signal: controller.signal }),
          fetch(apiUrl('/api/bcmi-orig/biweekly-wins'), { signal: controller.signal })
        ]);
        const [revenuePayload, raPayload, winsPayload] = await Promise.all([revenueResponse.json(), raResponse.json(), winsResponse.json()]);
        if (!revenueResponse.ok) throw new Error(revenuePayload.detail || 'Unable to load the revenue summary.');
        if (!controller.signal.aborted) {
          setRevenueSummary(revenuePayload.available ? revenuePayload.metrics : null);
          setRaSummary(raResponse.ok && raPayload.available ? raPayload.metrics : null);
          setBiweeklyWins(winsResponse.ok && winsPayload.available ? winsPayload : null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setRevenueSummary(null);
          setRaSummary(null);
          setBiweeklyWins(null);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingRevenue(false);
      }
    }
    loadRevenueSummary();
    return () => controller.abort();
  }, []);

  const revenuePeriods = { Aug: 'aug', Q3: 'q3', Q4: 'q4', Year: 'year' };
  const winRows = (biweeklyWins?.rows || []).map((row) => ({ ...row, netTcv: formatRa(row.netTcv), cyRevenue: formatRa(row.cyRevenue) }));
  return <><header><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5m4 5V4" /></svg><h1>BCM - Orig</h1></header><main className="container bcmi-page bcmi-orig-page"><h2 className="bcmi-orig-wordmark">BCMI</h2>{isLoadingRevenue ? <LoadingSpinner label="Loading BCM, Insurance, and RA data…" /> : <section className="bcmi-orig-grid"><div className="bcmi-orig-left"><table className="bcmi-orig-commit"><thead><tr><th rowSpan="2">Commit</th><th colSpan="4">RA</th></tr><tr><th>Revenue</th><th>RA</th><th>RA Achieved</th><th className="bcmi-orig-gap">GAP</th></tr></thead><tbody>{Object.entries(revenuePeriods).map(([label, period]) => <tr key={label}><th>{label}</th><td>{revenueSummary ? formatRevenue(revenueSummary[period]) : '—'}</td><td>{raSummary ? formatRa(raSummary[period]) : '—'}</td><td /><td /></tr>)}</tbody></table><section className="bcmi-orig-periods">{periods.map((period) => <OpportunityPanel key={period} period={period} />)}</section></div><aside className="bcmi-orig-right"><h2>Key Highlights</h2><div className="bcmi-orig-spacer" /><CompactTable title="Wins" amount={biweeklyWins?.latestWeek ? `Week ${biweeklyWins.latestWeek}` : '—'} headers={['S.No.', 'Account', 'Description', 'Total TCV', '2026-TCV']} rows={winRows.length ? winRows : [1, 2, 3, 4, 5]} /><CompactTable title="Revenue Erosion" amount="XXX" headers={['S.No.', 'Account', 'Description', 'Amount']} rows={[1, 2, 3, 4, 5]} /></aside></section>}</main></>;
}
