import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SalesSummary from './sales_summary.jsx';
import ForecastApp from './ForecastApp.jsx';
import UploadOption from './upload_option.jsx';
import { pendingSummary, pipelineSummary, revenueMetrics, wonSummary } from './test/test-utils.jsx';

describe('SalesSummary', () => {
  it('renders the top-level forecast app', () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ available: false, rows: [] }) }));
    render(<ForecastApp />);
    expect(screen.getByText('SLS Dashboard')).toBeInTheDocument();
  });

  it('renders only visible summaries and detail actions', async () => {
    const onRevenueDetailsClick = vi.fn();
    const onPipelineDetailsClick = vi.fn();
    const onTcvDetailsClick = vi.fn();
    const user = userEvent.setup();

    render(
      <SalesSummary
        revenueSummary={revenueMetrics()}
        pipelineSummary={pipelineSummary()}
        wonLostSummary={wonSummary()}
        pendingValidationSummary={pendingSummary()}
        targetTcvSummary={{ metrics: { targetTcv: 7_000_000, labels: { targetTcv: '$7.0M' } } }}
        onRevenueDetailsClick={onRevenueDetailsClick}
        onPipelineDetailsClick={onPipelineDetailsClick}
        onTcvDetailsClick={onTcvDetailsClick}
      />
    );

    expect(screen.getByText('Revenue Summary')).toBeInTheDocument();
    expect(screen.getByText('Pipeline Summary CY 2026')).toBeInTheDocument();
    expect(screen.getByText('Realized TCV Summary CY 2026')).toBeInTheDocument();
    expect(screen.getByText('Target TCV')).toBeInTheDocument();
    expect(screen.getByText('$7.0M')).toBeInTheDocument();
    expect(screen.getByText('$2.5M')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Revenue Details' }));
    await user.click(screen.getByRole('button', { name: 'Pipeline Details' }));
    await user.click(screen.getByRole('button', { name: 'TCV Details' }));

    expect(onRevenueDetailsClick).toHaveBeenCalledTimes(1);
    expect(onPipelineDetailsClick).toHaveBeenCalledTimes(1);
    expect(onTcvDetailsClick).toHaveBeenCalledTimes(1);
  });

  it('does not render when all summaries are empty', () => {
    const { container } = render(
      <SalesSummary
        revenueSummary={revenueMetrics({ forecast: 0 })}
        pipelineSummary={pipelineSummary({ metrics: { ...pipelineSummary().metrics, pipeline: 0 } })}
        wonLostSummary={wonSummary({ metrics: { won: 0, labels: { won: '$0.0M' } } })}
        pendingValidationSummary={pendingSummary({ metrics: { pendingValidation: 0, labels: { pendingValidation: '$0.0M' } } })}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('UploadOption', () => {
  it('selects and drops files, shows completion and errors', async () => {
    const onFileSelect = vi.fn();
    const workbook = new File(['x'], 'forecast.xlsx');
    const user = userEvent.setup();

    render(
      <UploadOption
        label="Revenue"
        title="Drop your revenue workbook here"
        subtitle="Supports .xlsx"
        error="Wrong file"
        icon="revenue"
        isComplete
        onFileSelect={onFileSelect}
      />
    );

    expect(screen.getByText('Wrong file')).toBeInTheDocument();
    await user.upload(document.querySelector('input[type="file"]'), workbook);
    expect(onFileSelect).toHaveBeenCalledWith(workbook, 'select');

    fireEvent.drop(screen.getByText('Revenue').closest('section'), {
      dataTransfer: { files: [workbook] }
    });
    expect(onFileSelect).toHaveBeenCalledWith(workbook, 'drop');

    fireEvent.dragOver(screen.getByText('Revenue').closest('section'));
    expect(screen.getByText('Revenue').closest('section')).toHaveClass('drag');
    fireEvent.dragLeave(screen.getByText('Revenue').closest('section'));
    expect(screen.getByText('Revenue').closest('section')).not.toHaveClass('drag');
  });
});
