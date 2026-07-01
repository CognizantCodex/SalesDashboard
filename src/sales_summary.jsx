import React from 'react';

export default function SalesSummary({ revenueSummary, pipelineSummary, wonLostSummary, pendingValidationSummary, targetTcvSummary, onRevenueDetailsClick, onPipelineDetailsClick, onTcvDetailsClick }) {
  if (!revenueSummary && !pipelineSummary && !wonLostSummary && !pendingValidationSummary && !targetTcvSummary) return null;

  const realizedYear = wonLostSummary?.year || pendingValidationSummary?.year;
  const targetTcv = targetTcvSummary?.metrics?.targetTcv || 0;
  const wonTcv = wonLostSummary?.metrics?.won || 0;
  const pendingValidationTcv = pendingValidationSummary?.metrics?.pendingValidation || 0;
  const totalTcvMillions = roundedMillions(wonTcv) + roundedMillions(pendingValidationTcv);
  const showRevenue = (revenueSummary?.forecast || 0) !== 0;
  const showPipeline = (pipelineSummary?.metrics?.pipeline || 0) !== 0;
  const showRealizedTcv = totalTcvMillions !== 0 || targetTcv !== 0;
  const hasVisibleSummary = showRevenue || showPipeline || showRealizedTcv;

  if (!hasVisibleSummary) return null;

  return (
    <section className="summary-panel">
      <SummaryGroup title="Revenue Summary" hidden={!showRevenue} action={onRevenueDetailsClick ? <button className="summary-link" onClick={onRevenueDetailsClick}>Revenue Details</button> : null}>
        {revenueSummary && (
          <>
            <Metric label="Forecast" value={revenueSummary.labels.forecast} />
            <Metric label="Target" value={revenueSummary.labels.target} />
            <Metric label="Gap" value={revenueSummary.labels.gap} tone={revenueSummary.status} />
            <Metric label="Accounts" value={revenueSummary.accounts} />
          </>
        )}
      </SummaryGroup>

      <SummaryGroup title={pipelineSummary ? 'Pipeline Summary CY ' + pipelineSummary.year : 'Pipeline Summary'} hidden={!showPipeline} action={onPipelineDetailsClick ? <button className="summary-link" onClick={onPipelineDetailsClick}>Pipeline Details</button> : null}>
        {pipelineSummary && (
          <>
            <Metric label="Total Pipeline" value={pipelineSummary.metrics.labels.pipeline} />
            <Metric label="Qualified Pipeline" value={pipelineSummary.metrics.labels.qualified} />
            <Metric label="Un-Qualified Pipeline" value={pipelineSummary.metrics.labels.unqualified} />
            <Metric label="Accounts" value={pipelineSummary.metrics.accounts} />
          </>
        )}
      </SummaryGroup>

      <SummaryGroup title={realizedYear ? 'Realized TCV Summary CY ' + realizedYear : 'Realized TCV Summary'} hidden={!showRealizedTcv} action={onTcvDetailsClick ? <button className="summary-link" onClick={onTcvDetailsClick}>TCV Details</button> : null}>
        <Metric label="Target TCV" value={targetTcvSummary?.metrics?.labels?.targetTcv || '$0.0M'} />
        <Metric label="Total TCV" value={formatMillionLabel(totalTcvMillions)} />
        <Metric label="Won TCV" value={wonLostSummary?.metrics?.labels?.won || '$0.0M'} />
        <Metric label="Pending Validation TCV" value={pendingValidationSummary?.metrics?.labels?.pendingValidation || '$0.0M'} />
      </SummaryGroup>
    </section>
  );
}

function SummaryGroup({ title, hidden, action, children }) {
  if (hidden) return null;

  return (
    <section className="summary-group">
      <h2>{title}{action}</h2>
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

function roundedMillions(value) {
  return Math.round((value / 1000000) * 10) / 10;
}

function formatMillionLabel(value) {
  return '$' + value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M';
}
