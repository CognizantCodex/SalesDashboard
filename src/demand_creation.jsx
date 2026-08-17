import React, { useState } from 'react';
import { apiUrl } from './api.js';
import UploadOption from './upload_option.jsx';

const VALID_WORKBOOK = /\.(xlsb|xlsx|xlsm)$/i;
const SKILL_LOCATION_ROWS = ['Java', 'FSD', '.Net', 'UI – React/Angular'];

function demandLabel(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export default function DemandCreation() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  React.useEffect(() => {
    let isActive = true;
    fetch(apiUrl('/api/demand-creation/current'))
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (isActive && payload?.available) setResult(payload); })
      .catch(() => {});
    return () => { isActive = false; };
  }, []);

  async function handleFileSelect(file) {
    setError('');
    if (!file) return;
    if (!VALID_WORKBOOK.test(file.name)) {
      setError('Please select a .xlsx, .xlsm, or .xlsb workbook.');
      return;
    }

    setIsUploading(true);
    try {
      const form = new FormData();
      form.append('workbook', file);
      const response = await fetch(apiUrl('/api/demand-creation/upload'), { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to process the demand workbook.');
      setResult(payload);
    } catch (uploadError) {
      setError(uploadError.message);
      setResult(null);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <>
      <header>
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5m4 5V4" />
        </svg>
        <h1>Demand Profile &amp; Top Accounts <span>BCM &amp; INS 2</span></h1>
      </header>

      <main className="container demand-page">
        <UploadOption
          className="demand-upload"
          label="Demand creation workbook"
          title={result?.sourceFilename || 'Drop a Demand Creation workbook here'}
          subtitle="Reads the BCM and INS2 sheets and aggregates demand counts by week"
          icon="pipeline"
          error={error}
          isComplete={Boolean(result?.available)}
          onFileSelect={handleFileSelect}
        />

        {isUploading && <div className="targets-loading"><span className="spinner" aria-hidden="true" />Processing weekly demand data...</div>}

        {result && (
          <section className="demand-executive-grid">
            <div className="demand-left-stack">
              <DemandProfileTable data={result.demandProfile} />
              <SkillLocationTable />
            </div>
            <div className="demand-right-stack">
              <DemandLineChart rows={result.series || []} />
              <TopAccountsTable data={result.topAccounts} />
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function SkillLocationTable() {
  return (
    <section className="skill-location-card" aria-label="Demand by skill and location">
      <h2>By Skill / Location</h2>
      <table>
        <thead>
          <tr><th rowSpan="2">Skills</th><th colSpan="3">Onsite</th><th colSpan="3">Offshore</th></tr>
          <tr><th>Major US<br />Location 1</th><th>Major US<br />Location 2</th><th>Others</th><th>Major India<br />Location 1</th><th>Major India<br />Location 2</th><th>Others</th></tr>
        </thead>
        <tbody>{SKILL_LOCATION_ROWS.map((skill) => <tr key={skill}><th scope="row">{skill}</th>{Array.from({ length: 6 }, (_, index) => <td key={index}>—</td>)}</tr>)}</tbody>
      </table>
    </section>
  );
}

function DemandProfileTable({ data }) {
  const months = data?.months || [];
  const quarters = data?.quarters || [];
  const rows = data?.rows || [];
  if (!rows.length) return null;

  return (
    <section className="demand-profile-card" aria-label="Demand profile">
      <h2>Demand Profile</h2>
      <table className="demand-profile-table">
        <thead><tr><th>BU</th><th>Total</th>{months.map((month) => <th key={month.key}>{month.label}</th>)}{quarters.map((quarter) => <th key={quarter.key}>{quarter.label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.name}><th scope="row">{row.name}</th><td>{demandLabel(row.total)}</td>{months.map((month) => <td key={month.key}>{demandLabel(row.months?.[month.key])}</td>)}{quarters.map((quarter) => <td key={quarter.key}>{demandLabel(row.quarters?.[quarter.key])}</td>)}</tr>)}</tbody>
      </table>
    </section>
  );
}

function TopAccountsTable({ data }) {
  const months = data?.months || [];
  const quarters = data?.quarters || [];
  const rows = data?.rows || [];
  if (!rows.length) return null;

  return (
    <section className="top-accounts-wrap" aria-label="Top 10 demand accounts">
      <h2>Top 10 Accounts</h2>
      <div className="top-accounts-scroll">
        <table className="top-accounts-table">
          <colgroup>
            <col className="top-accounts-serial-column" />
            <col className="top-accounts-name-column" />
            <col className="top-accounts-description-column" />
            {months.map((month) => <col key={month.key} className="top-accounts-value-column" />)}
            {quarters.map((quarter) => <col key={quarter.key} className="top-accounts-value-column" />)}
            <col className="top-accounts-total-column" />
          </colgroup>
          <thead><tr><th>S.No</th><th>Account Name</th><th>Description</th>{months.map((month) => <th key={month.key}>{month.label}</th>)}{quarters.map((quarter) => <th key={quarter.key}>{quarter.label}</th>)}<th>Total Demands</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.account}>
            <td>{index + 1}</td><td>{row.account}</td><td>{row.description}</td>
            {months.map((month) => <td key={month.key}>{demandLabel(row.months?.[month.key])}</td>)}
            {quarters.map((quarter) => <td key={quarter.key}>{demandLabel(row.quarters?.[quarter.key])}</td>)}
            <td>{demandLabel(row.total)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function DemandLineChart({ rows }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const width = 960;
  const height = 280;
  const margin = { top: 30, right: 34, bottom: 58, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxDemand = Math.max(1, ...rows.flatMap((row) => [Number(row.BCM || 0), Number(row.INS2 || 0)]));
  const yMax = Math.ceil(maxDemand / 5) * 5 || 5;
  const yTicks = Array.from({ length: 6 }, (_, index) => (yMax / 5) * index);
  const xAt = (index) => margin.left + (rows.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (rows.length - 1));
  const yAt = (value) => margin.top + chartHeight - ((Number(value || 0) / yMax) * chartHeight);
  const pathFor = (key) => rows.map((row, index) => `${index ? 'L' : 'M'} ${xAt(index)} ${yAt(row[key])}`).join(' ');
  const tooltip = hoveredPoint && (() => {
    const pointX = xAt(hoveredPoint.index);
    const pointY = yAt(rows[hoveredPoint.index][hoveredPoint.series]);
    const label = `${hoveredPoint.label}: ${demandLabel(rows[hoveredPoint.index][hoveredPoint.series])} demands`;
    const tooltipWidth = Math.max(165, label.length * 7 + 20);
    return {
      x: Math.max(margin.left, Math.min(pointX - tooltipWidth / 2, width - margin.right - tooltipWidth)),
      y: pointY - 43 < margin.top ? pointY + 13 : pointY - 43,
      width: tooltipWidth,
      label
    };
  })();

  return (
    <section className="demand-chart-card">
      <h2 className="demand-chart-title">Week on Week demand generation chart</h2>
      <div className="demand-chart-scroll">
        <svg className="demand-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Weekly demands for BCM and INS 2">
          {yTicks.map((tick) => {
            const y = yAt(tick);
            return <g key={tick}><line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="demand-gridline" /><text x={margin.left - 12} y={y + 4} className="demand-axis-label" textAnchor="end">{demandLabel(tick)}</text></g>;
          })}
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} className="demand-axis" />
          <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} className="demand-axis" />
          <path d={pathFor('BCM')} className="demand-line bcm-line" />
          <path d={pathFor('INS2')} className="demand-line ins2-line" />
          {rows.map((row, index) => <g key={row.week}>
            <circle cx={xAt(index)} cy={yAt(row.BCM)} r="7" className="demand-point-hit-area" onMouseEnter={() => setHoveredPoint({ index, series: 'BCM', label: `BCM · ${row.weekLabel}` })} onMouseLeave={() => setHoveredPoint(null)} onFocus={() => setHoveredPoint({ index, series: 'BCM', label: `BCM · ${row.weekLabel}` })} onBlur={() => setHoveredPoint(null)} tabIndex="0" aria-label={`BCM, ${row.weekLabel}, ${demandLabel(row.BCM)} demands`} />
            <circle cx={xAt(index)} cy={yAt(row.BCM)} r="4" className="bcm-point" pointerEvents="none" />
            <circle cx={xAt(index)} cy={yAt(row.INS2)} r="7" className="demand-point-hit-area" onMouseEnter={() => setHoveredPoint({ index, series: 'INS2', label: `INS 2 · ${row.weekLabel}` })} onMouseLeave={() => setHoveredPoint(null)} onFocus={() => setHoveredPoint({ index, series: 'INS2', label: `INS 2 · ${row.weekLabel}` })} onBlur={() => setHoveredPoint(null)} tabIndex="0" aria-label={`INS 2, ${row.weekLabel}, ${demandLabel(row.INS2)} demands`} />
            <circle cx={xAt(index)} cy={yAt(row.INS2)} r="4" className="ins2-point" pointerEvents="none" />
            <text x={xAt(index)} y={height - margin.bottom + 23} className="demand-axis-label" textAnchor="middle">{row.weekLabel}</text>
          </g>)}
          {tooltip && <g className="demand-tooltip" pointerEvents="none">
            <rect x={tooltip.x} y={tooltip.y} width={tooltip.width} height="30" rx="5" />
            <text x={tooltip.x + 10} y={tooltip.y + 20}>{tooltip.label}</text>
          </g>}
          <text x={width / 2} y={height - 18} className="demand-axis-title" textAnchor="middle">Week of demand creation</text>
          <text x="18" y={height / 2} className="demand-axis-title" textAnchor="middle" transform={`rotate(-90 18 ${height / 2})`}>Demands</text>
        </svg>
      </div>
    </section>
  );
}
