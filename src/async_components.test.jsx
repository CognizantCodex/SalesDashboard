import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SalesPendingValidation from './sales_pending_validation.jsx';
import SalesPipeline from './sales_pipeline.jsx';
import SalesRevenue from './sales_revenue.jsx';
import SalesTcvDetails from './sales_tcv_details.jsx';
import SalesWonLost from './sales_won_lost.jsx';
import { file, fileList, jsonResponse, mockFetch, pendingSummary, pipelineSummary, revenueMetrics, wonSummary } from './test/test-utils.jsx';

function forecastPayload() {
  return {
    available: true,
    matchedSlsNames: ['Seller A'],
    metrics: revenueMetrics(),
    accounts: [],
    rows: [],
    database: { rowsSaved: 2, sourceFilename: 'forecast.xlsx' }
  };
}

describe('SalesRevenue', () => {
  it('loads saved metadata and runs saved forecast analysis', async () => {
    const onSummaryChange = vi.fn();
    const onMatchedNamesChange = vi.fn();
    const onResultChange = vi.fn();

    mockFetch((url) => {
      if (url.includes('/metadata')) return { available: true, database: { rowsSaved: 5, sourceFilename: 'saved.xlsx' } };
      return forecastPayload();
    });

    render(
      <SalesRevenue
        slsName="Seller A"
        runRequestId={1}
        onLoadingChange={vi.fn()}
        onSummaryChange={onSummaryChange}
        onMatchedNamesChange={onMatchedNamesChange}
        onResultChange={onResultChange}
        onWorkbookChange={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('saved.xlsx')).toBeInTheDocument());
    await waitFor(() => expect(onSummaryChange).toHaveBeenCalledWith(expect.objectContaining({ forecast: 1000 })));
    expect(onMatchedNamesChange).toHaveBeenCalledWith(['Seller A']);
    expect(onResultChange).toHaveBeenCalledWith(expect.objectContaining({ available: true }));
  });

  it('validates selected file type and posts uploaded workbook', async () => {
    const user = userEvent.setup();
    const onSummaryChange = vi.fn();
    const onWorkbookChange = vi.fn();
    mockFetch((url, options) => {
      if (url.includes('/metadata')) return { available: false };
      if (options.method === 'POST') return forecastPayload();
      return { available: false };
    });

    const { rerender } = render(
      <SalesRevenue
        slsName="Seller A"
        runRequestId={0}
        onLoadingChange={vi.fn()}
        onSummaryChange={onSummaryChange}
        onMatchedNamesChange={vi.fn()}
        onResultChange={vi.fn()}
        onWorkbookChange={onWorkbookChange}
      />
    );

    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: fileList(new File(['x'], 'bad.txt', { type: 'text/plain' })) }
    });
    expect(await screen.findByText('Please select a .xlsb, .xlsx, or .xlsm workbook.')).toBeInTheDocument();

    const workbook = file('forecast.xlsx');
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: fileList(workbook) }
    });
    expect(onWorkbookChange).toHaveBeenCalledWith(workbook);

    rerender(
      <SalesRevenue
        slsName="Seller A"
        runRequestId={1}
        onLoadingChange={vi.fn()}
        onSummaryChange={onSummaryChange}
        onMatchedNamesChange={vi.fn()}
        onResultChange={vi.fn()}
        onWorkbookChange={onWorkbookChange}
        externalWorkbook={workbook}
      />
    );

    await waitFor(() => expect(onSummaryChange).toHaveBeenCalledWith(expect.objectContaining({ forecast: 1000 })));
  });
});

describe('SalesPipeline', () => {
  it('loads metadata and summarizes saved pipeline for selected name', async () => {
    const onSummaryChange = vi.fn();
    mockFetch((url) => {
      if (url.includes('/metadata')) return { available: true, database: { rowsSaved: 10, sourceFilename: 'pipeline.xlsx' } };
      return pipelineSummary();
    });

    render(<SalesPipeline slsName="Seller A" onSummaryChange={onSummaryChange} onResultChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('pipeline.xlsx')).toBeInTheDocument());
    await waitFor(() => expect(onSummaryChange).toHaveBeenCalledWith(expect.objectContaining({ year: 2026 })));
  });

  it('uploads valid pipeline files and rejects invalid files', async () => {
    const user = userEvent.setup();
    const onUploadChange = vi.fn();
    const onSummaryChange = vi.fn();
    mockFetch((url, options) => {
      if (url.includes('/metadata')) return { available: false };
      if (url.includes('/upload')) return { available: true, database: { rowsSaved: 3, sourceFilename: 'pipeline.xlsx' } };
      if (options.method === 'POST') return pipelineSummary();
      return pipelineSummary();
    });

    render(<SalesPipeline slsName="Seller A" onSummaryChange={onSummaryChange} onUploadChange={onUploadChange} onResultChange={vi.fn()} />);
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: fileList(new File(['x'], 'bad.csv', { type: 'text/csv' })) }
    });
    expect(await screen.findByText('Please select a .xlsb, .xlsx, or .xlsm workbook.')).toBeInTheDocument();

    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: fileList(file('pipeline.xlsx')) }
    });
    await waitFor(() => expect(onUploadChange).toHaveBeenCalled());
    expect(screen.getByText('pipeline.xlsx')).toBeInTheDocument();
  });
});

describe('silent summary loaders', () => {
  it('loads won/lost and pending validation summaries', async () => {
    const onWon = vi.fn();
    const onPending = vi.fn();
    mockFetch((url) => (url.includes('won-lost') ? wonSummary() : pendingSummary()));

    render(
      <>
        <SalesWonLost slsName="Seller A" uploadVersion={1} onSummaryChange={onWon} />
        <SalesPendingValidation slsName="Seller A" uploadVersion={1} onSummaryChange={onPending} />
      </>
    );

    await waitFor(() => expect(onWon).toHaveBeenCalledWith(expect.objectContaining({ year: 2026 })));
    await waitFor(() => expect(onPending).toHaveBeenCalledWith(expect.objectContaining({ year: 2026 })));
  });

  it('clears summaries for blank names and failed requests', async () => {
    const onWon = vi.fn();
    const onPending = vi.fn();
    global.fetch = vi.fn(() => jsonResponse({ detail: 'failed' }, false));

    render(
      <>
        <SalesWonLost slsName="" uploadVersion={1} onSummaryChange={onWon} />
        <SalesPendingValidation slsName="Seller A" uploadVersion={1} onSummaryChange={onPending} />
      </>
    );

    expect(onWon).toHaveBeenCalledWith(null);
    await waitFor(() => expect(onPending).toHaveBeenCalledWith(null));
  });
});

describe('SalesTcvDetails', () => {
  it('adds Target TCV by account and practice from uploaded targets', async () => {
    mockFetch((url) => {
      if (url.includes('/api/targets/accounts/current')) {
        return {
          available: true,
          rows: [
            {
              accountName: 'BROADRIDGE FINANCIAL',
              metrics: {
                'TCV-DE': 300000,
                'TCV-SPE': 300000
              }
            }
          ]
        };
      }
      return { available: false };
    });

    render(
      <SalesTcvDetails
        wonLostSummary={{
          available: true,
          query: 'Seller A',
          year: 2026,
          metrics: { won: 136000, labels: { won: '$0.1M' } },
          rows: [
            {
              account: 'BROADRIDGE FINANCIAL',
              practice: 'Digital Engineering',
              dealType: 'Unspecified',
              won: 136000,
              rows: 1
            }
          ]
        }}
        pendingValidationSummary={null}
        onBack={vi.fn()}
      />
    );

    expect((await screen.findAllByText('Target TCV')).length).toBeGreaterThan(0);
    expect(screen.getByText('Digital Engineering')).toBeInTheDocument();
    expect(screen.getAllByText('$0.3M').length).toBeGreaterThan(0);
    expect(screen.queryByText('SPE')).not.toBeInTheDocument();
  });
});
