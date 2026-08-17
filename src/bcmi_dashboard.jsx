import React from 'react';

const forecastRows = [
  ['BCMI', '243', '261', '262.5', '268.4', '+2.8%', '+7.3', '2.5', '0.9', '-1.6', '254.4', '261.5', '-2.5%', '-6.8', '11.4', '9.9', '-1.5'],
  ['Banking & Capital Markets - NA', '171.4', '186.8', '190.9', '196.3', '+5.1%', '+9.5', '1.3', '0.0', '-1.3', '181.4', '188.3', '-4.1%', '-8.0', '6.6', '4.0', '-2.6'],
  ['Insurance 2', '72', '74', '71.6', '72.0', '-3.0%', '-2.0', '1.2', '0.9', '-0.3', '73.0', '73.2', '+1.7%', '+1.2', '4.8', '5.9', '+1.1'],
];

const deals = [
  ['The Hartford', 'Bond Modernization', 'Mainframe Mod', '$860k', '$860k', '$0.1M', '20 (2 On, 18 Off)'],
  ['Lincoln', 'AWS Hosting Services, App Dev and Licensing', 'AWS - Hyperscaler', '$65M', '$7.5M', '$0.5M', ''],
  ['DOXA', 'Application Services', '', '$1.8M', '$1.8M', '$0.12M', '8 (1 On, 7 Off)'],
  ['TIAA', 'Wealth Brokerage', 'Anthropic', '$0.6M', '$0.6M', '$0.1M', '8 (1 On, 7 Off)'],
  ['Northern Trust', 'SQM RFP', 'OpenAI', '$76.8M', '$86.8M', '$0.38M', '100 (20 On, 80 Off)'],
  ['UBS', '11 onshore QA resources', '', '$0.6M', '$0.07M', '$0.13M', '11 (all offshore)'],
  ['Morgan Stanley', 'MS@Work additional roles', 'OpenAI', '$8.2M', '$4.4M', '$.02M', '40 (10 on, 30 off)'],
  ['S&P', 'Index Prototyping Platform & SIB – Spice Index Builders', '', '$2.5M', '$2.0M', '$0.25M', '13 (5 on, 8 off)'],
  ['Wells Fargo', 'FDEs for AI CoE', 'Devin', '$1.1M', '$1.1M', '$0.13M', '10 (5 on, 5 off)'],
  ['JPMC', 'HR Tech Employee Product App Dev-JUL 2026', '', '$2.1M', '$2.1M', '$0.14M', '10 On, 10 off'],
  ['', 'Other Deals in pipeline -', '', '', '', '$0.5M', ''],
];

function ForecastCell({ value, index }) {
  const isDiff = [6, 9, 13, 16].includes(index);
  const positive = String(value).startsWith('+');
  const negative = String(value).startsWith('-');
  return <td className={isDiff ? (positive ? 'bcmi-positive' : negative ? 'bcmi-negative' : '') : ''}>{value}</td>;
}

export default function BcmiDashboard() {
  return (
    <>
      <header>
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5m4 5V4" /></svg>
        <h1>BCMI</h1>
      </header>
      <main className="container bcmi-page bcmi-executive-page">
        <h2 className="bcmi-wordmark">BCMI</h2>
        <section className="bcmi-forecast-wrap" aria-label="BCMI revenue forecast and risk adjustment">
          <table className="bcmi-forecast-table">
            <thead>
              <tr><th rowSpan="2">BU</th><th rowSpan="2">Q1'26</th><th rowSpan="2">Q2'26</th><th colSpan="4">Q3 Revenue Forecast</th><th colSpan="3">Risk Adjustment</th><th colSpan="4">Q4 Revenue Forecast</th><th colSpan="3">Risk Adjustment</th></tr>
              <tr>{['Prior Commit', 'Current Commit', 'QoQ', 'Diff.', 'Prior Commit', 'Current Commit', 'Diff.', 'Prior Commit', 'Current Commit', 'QoQ', 'Diff.', 'Prior Commit', 'Current Commit', 'Diff.'].map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}</tr>
            </thead>
            <tbody>{forecastRows.map((row, rowIndex) => <tr key={row[0]}>{row.map((value, index) => index === 0 ? <th key={index} scope="row" className={rowIndex ? 'bcmi-child-bu' : ''}>{value}</th> : <ForecastCell key={index} value={value} index={index} />)}</tr>)}</tbody>
          </table>
        </section>
        <hr className="bcmi-rule" />
        <h2 className="bcmi-section-heading">Q3 RA Coverage Deals</h2>
        <section className="bcmi-deal-layout">
          <div className="bcmi-deals-wrap">
            <table className="bcmi-deals-table">
              <thead><tr>{['Account', 'Deal Name', 'Category (Frontier Model /Mainframe/ Hyperscaler etc)', 'Overall TCV', 'SEG Share', "Q3'26 Rev.", 'No. of FTEs'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
              <tbody>
                {deals.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((value, column) => <td key={column}>{value}</td>)}</tr>)}
                <tr className="bcmi-deals-total"><td colSpan="5">Total</td><td>$2.37 M</td><td /></tr>
              </tbody>
            </table>
          </div>
          <aside className="bcmi-large-deals">
            <h2>Large deals: Proactive and RFP’s</h2>
            <ol>
              <li>Illumifin Managed Services - $120Mn over 5 years</li>
              <li>Lincoln Financial Vendor Consolidation - $175M over 5 Year</li>
              <li>Edward Jones L1/L2/SRE - $18M</li>
              <li>Truist – Data Estate Modernization RFP ($32 M, SEG $9M)</li>
              <li>LPL UAT Services - $8M</li>
            </ol>
          </aside>
        </section>
      </main>
    </>
  );
}
