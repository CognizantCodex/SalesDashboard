import React from 'react';

export default function SalesSummary({ revenueSummary, pipelineSummary }) {
  if (!revenueSummary && !pipelineSummary) return null;

  return (
    <section className="summary-panel">
      <SummaryGroup title="Revenue Summary" hidden={!revenueSummary}>
        {revenueSummary && (
          <>
            <Metric label="Forecast" value={revenueSummary.labels.forecast} />
            <Metric label="Target" value={revenueSummary.labels.target} />
            <Metric label="Gap" value={revenueSummary.labels.gap} tone={revenueSummary.status} />
            <Metric label="Accounts" value={revenueSummary.accounts} />
          </>
        )}
      </SummaryGroup>

      <SummaryGroup title={pipelineSummary ? 'Pipeline Summary CY ' + pipelineSummary.year : 'Pipeline Summary'} hidden={!pipelineSummary}>
        {pipelineSummary && (
          <>
            <Metric label="Total Pipeline" value={pipelineSummary.metrics.labels.pipeline} />
            <Metric label="Qualified Pipeline" value={pipelineSummary.metrics.labels.qualified} />
            <Metric label="Un-Qualified Pipeline" value={pipelineSummary.metrics.labels.unqualified} />
            <Metric label="Accounts" value={pipelineSummary.metrics.accounts} />
          </>
        )}
      </SummaryGroup>
    </section>
  );
}

function SummaryGroup({ title, hidden, children }) {
  if (hidden) return null;

  return (
    <section className="summary-group">
      <h2>{title}</h2>
      <div className="summary-grid">{children}</div>
    </section>
  );
}

function Metric({ label, value, tone = '' }) {
  return (
    <article className="metric">
      <div className="metric-label">{label}</div>
      <div className={'metric-val ' + statusClass(tone)}>{value}</div>
    </article>
  );
}

function statusClass(status) {
  if (status === 'behind') return 'red';
  if (status === 'ahead') return 'green';
  return 'muted';
}
