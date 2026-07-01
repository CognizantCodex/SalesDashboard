import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SalesForecast from './sales_forecast.jsx';
import SlslSummary from './slsl_summary.jsx';
import SlsmSummary from './slsm_summary.jsx';
import { fileList, jsonResponse, mockFetch, pendingSummary, pipelineSummary, revenueMetrics, slsBreakdownPayload, slslSummaryPayload, wonSummary } from './test/test-utils.jsx';

vi.mock('./sales_revenue.jsx', () => ({
  default: ({ slsName, runRequestId, onSummaryChange, onMatchedNamesChange, onResultChange, onLoadingChange }) => {
    React.useEffect(() => {
      if (!slsName) {
        onSummaryChange(null);
        onMatchedNamesChange([]);
        onResultChange(null);
        return;
      }
      onLoadingChange(false);
      onSummaryChange(revenueMetrics());
      onMatchedNamesChange([slsName]);
      onResultChange({ query: slsName, metrics: revenueMetrics(), accounts: [], rows: [] });
    }, [slsName, runRequestId]);
    return <section data-testid="mock-revenue">Revenue Upload {slsName}</section>;
  }
}));

vi.mock('./sales_pipeline.jsx', () => ({
  default: ({ slsName, onSummaryChange, onResultChange }) => {
    React.useEffect(() => {
      if (!slsName) {
        onSummaryChange(null);
        onResultChange(null);
        return;
      }
      const payload = pipelineSummary({ query: slsName });
      onSummaryChange(payload);
      onResultChange(payload);
    }, [slsName]);
    return <section data-testid="mock-pipeline">Pipeline Upload {slsName}</section>;
  }
}));

vi.mock('./sales_won_lost.jsx', () => ({
  default: ({ slsName, onSummaryChange }) => {
    React.useEffect(() => onSummaryChange(slsName ? wonSummary({ query: slsName }) : null), [slsName]);
    return null;
  }
}));

vi.mock('./sales_pending_validation.jsx', () => ({
  default: ({ slsName, onSummaryChange }) => {
    React.useEffect(() => onSummaryChange(slsName ? pendingSummary({ query: slsName }) : null), [slsName]);
    return null;
  }
}));

vi.mock('./sales_revenue_details.jsx', () => ({ default: ({ onBack }) => <button onClick={onBack}>Back Revenue</button> }));
vi.mock('./sales_pipeline_details.jsx', () => ({ default: ({ onBack }) => <button onClick={onBack}>Back Pipeline</button> }));
vi.mock('./sales_tcv_details.jsx', () => ({ default: ({ onBack }) => <button onClick={onBack}>Back TCV</button> }));

function setupFetch() {
  return mockFetch((url) => {
    if (url.includes('/api/slsl/summary/current')) return slslSummaryPayload();
    if (url.includes('/api/slsm/forecast/options/current')) return { available: true, options: ['Alpha Manager'] };
    if (url.includes('/api/slsm/sls-breakdown/current')) return slsBreakdownPayload();
    if (url.includes('/api/targets/accounts/current')) {
      return {
        available: true,
        matchedSlsNames: ['Seller A', 'Seller A + Seller B'],
        metrics: ['Rev-ADM', 'TCV-SPE', 'ACV-SPE', 'Rev-SPE', 'TCV-ADM'],
        rows: [
          {
            rowNumber: 5,
            slsName: 'Seller A',
            accountName: 'Account A',
            metrics: { 'TCV-SPE': 8000000, 'ACV-SPE': 7000000, 'Rev-SPE': 4000000, 'Rev-ADM': 1000000, 'TCV-ADM': 8000000 },
            labels: { 'TCV-SPE': '$8.0M', 'ACV-SPE': '$7.0M', 'Rev-SPE': '$4.0M', 'Rev-ADM': '$1.0M', 'TCV-ADM': '$8.0M' }
          },
          {
            rowNumber: 6,
            slsName: 'Seller A + Seller B',
            accountName: 'Combination Account',
            metrics: { 'TCV-SPE': 5000000, 'ACV-SPE': 3000000, 'Rev-SPE': 2000000, 'Rev-ADM': 500000, 'TCV-ADM': 5000000 },
            labels: { 'TCV-SPE': '$5.0M', 'ACV-SPE': '$3.0M', 'Rev-SPE': '$2.0M', 'Rev-ADM': '$0.5M', 'TCV-ADM': '$5.0M' }
          }
        ]
      };
    }
    if (url.includes('/api/targets/upload')) {
      return {
        available: true,
        database: {
          available: true,
          sourceFilename: 'targets.xlsx',
          sheet: 'SLM-SLS-Pivot',
          slsCount: 1,
          accountCount: 1
        },
        metrics: ['Rev-ADM', 'TCV-SPE', 'ACV-SPE', 'Rev-SPE', 'TCV-ADM'],
        rows: [
          {
            rowNumber: 4,
            slsName: 'Seller A',
            metrics: { 'TCV-SPE': 20000000, 'ACV-SPE': 15000000, 'Rev-SPE': 10000000, 'Rev-ADM': 2000000, 'TCV-ADM': 20000000 },
            labels: { 'TCV-SPE': '$20.0M', 'ACV-SPE': '$15.0M', 'Rev-SPE': '$10.0M', 'Rev-ADM': '$2.0M', 'TCV-ADM': '$20.0M' }
          }
        ]
      };
    }
    if (url.includes('/api/targets/current')) {
      return {
        available: true,
        database: {
          available: true,
          sourceFilename: 'saved-targets.xlsb',
          sheet: 'SLM-SLS-Pivot',
          slsCount: 1,
          accountCount: 1
        },
        metrics: ['Rev-ADM', 'TCV-SPE', 'ACV-SPE', 'Rev-SPE', 'TCV-ADM'],
        rows: [
          {
            rowNumber: 4,
            slsName: 'Seller A',
            metrics: { 'TCV-SPE': 20000000, 'ACV-SPE': 15000000, 'Rev-SPE': 10000000, 'Rev-ADM': 2000000, 'TCV-ADM': 20000000 },
            labels: { 'TCV-SPE': '$20.0M', 'ACV-SPE': '$15.0M', 'Rev-SPE': '$10.0M', 'Rev-ADM': '$2.0M', 'TCV-ADM': '$20.0M' }
          }
        ]
      };
    }
    if (url.includes('/metadata')) return { available: true, database: { rowsSaved: 5, sourceFilename: 'saved.xlsx' } };
    return { available: true };
  });
}

describe('SLSL summary', () => {
  it('renders summaries, totals and emits SLSM drilldown selections', async () => {
    const onSlsmSelect = vi.fn();
    setupFetch();

    render(<SlslSummary forecastWorkbook={null} onForecastWorkbookChange={vi.fn()} onSlsmSelect={onSlsmSelect} />);

    expect(await screen.findByText('Alpha Manager')).toBeInTheDocument();
    expect(screen.getByText('Revenue Summary')).toBeInTheDocument();
    expect(screen.getByText('SLSM Breakdown')).toBeInTheDocument();
    expect(screen.getAllByText('$2.5M').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Alpha Manager' }));
    expect(onSlsmSelect).toHaveBeenCalledWith('Alpha Manager');
  });

  it('validates SLSL revenue uploads', async () => {
    const onForecastWorkbookChange = vi.fn();
    setupFetch();
    const user = userEvent.setup();

    render(<SlslSummary forecastWorkbook={null} onForecastWorkbookChange={onForecastWorkbookChange} />);
    await screen.findByText('SLSM Breakdown');

    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: fileList(new File(['x'], 'bad.txt', { type: 'text/plain' })) }
    });
    expect(await screen.findByText('Please select a .xlsb, .xlsx, or .xlsm workbook.')).toBeInTheDocument();

    const workbook = new File(['x'], 'forecast.xlsx');
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: fileList(workbook) }
    });
    expect(onForecastWorkbookChange).toHaveBeenCalledWith(workbook);
  });
});

describe('SLSM summary', () => {
  it('preselects SLSM, shows SLS breakdown and emits SLS drilldown selections', async () => {
    const onSlsSelect = vi.fn();
    setupFetch();

    render(
      <SlsmSummary
        forecastWorkbook={null}
        onForecastWorkbookChange={vi.fn()}
        selectedSlsmName="Alpha Manager"
        onBackToSlsl={vi.fn()}
        onSlsSelect={onSlsSelect}
      />
    );

    expect(await screen.findByDisplayValue('Alpha Manager')).toBeInTheDocument();
    expect(await screen.findByText('SLS Breakdown')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Seller A' }));
    expect(onSlsSelect).toHaveBeenCalledWith('Seller A', 'Alpha Manager');
  });
});

describe('SalesForecast navigation', () => {
  it('drills from SLSL to SLSM to SLS and supports contextual back buttons', async () => {
    setupFetch();
    const user = userEvent.setup();

    render(<SalesForecast />);

    await user.click(screen.getByRole('button', { name: 'SLSL' }));
    await user.click(await screen.findByRole('button', { name: 'Alpha Manager' }));

    expect(await screen.findByText('SLSM Summary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to SLSL' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Seller A' }));

    expect(await screen.findByText('SLS Dashboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to SLSM' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Seller A')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to SLSM' }));
    expect(await screen.findByDisplayValue('Alpha Manager')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'SLS' }));
    expect(screen.getByPlaceholderText('Enter SLS name')).toHaveValue('');
  });

  it('opens detail pages and returns to dashboard', async () => {
    setupFetch();
    const user = userEvent.setup();

    render(<SalesForecast />);
    await user.type(screen.getByPlaceholderText('Enter SLS name'), 'Seller A');
    await screen.findByText('Revenue Summary');

    await user.click(screen.getByRole('button', { name: 'Revenue Details' }));
    await user.click(screen.getByRole('button', { name: 'Back Revenue' }));
    expect(screen.getByText('Revenue Summary')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pipeline Details' }));
    await user.click(screen.getByRole('button', { name: 'Back Pipeline' }));
    expect(screen.getByText('Pipeline Summary CY 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'TCV Details' }));
    await user.click(screen.getByRole('button', { name: 'Back TCV' }));
    expect(screen.getByText('Realized TCV Summary CY 2026')).toBeInTheDocument();
  });

  it('opens Target, replaces uploads and drills into account rows', async () => {
    setupFetch();
    const user = userEvent.setup();

    render(<SalesForecast />);

    await user.click(screen.getByRole('button', { name: 'Target' }));
    expect(await screen.findByRole('heading', { name: /Upload Targets/ })).toBeInTheDocument();
    expect((await screen.findAllByText('saved-targets.xlsb')).length).toBeGreaterThan(0);
    expect(screen.getByText('SLS Target Summary')).toBeInTheDocument();

    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: fileList(new File(['x'], 'bad.txt', { type: 'text/plain' })) }
    });
    expect(await screen.findByText('Please select a .xlsb, .xlsx, or .xlsm workbook.')).toBeInTheDocument();

    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: fileList(new File(['x'], 'targets.xlsx')) }
    });
    expect((await screen.findAllByText('targets.xlsx')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Seller A' }));
    expect(await screen.findByText('Seller A Accounts')).toBeInTheDocument();
    expect(screen.getByText('Account A')).toBeInTheDocument();
    expect(screen.getByText('Seller A + Seller B')).toBeInTheDocument();
    expect(screen.getByText('Combination Account')).toBeInTheDocument();
    const tables = screen.getAllByRole('table');
    const accountTable = tables[tables.length - 1];
    const accountHeaders = within(accountTable).getAllByRole('columnheader').map((header) => header.textContent);
    expect(accountHeaders.slice(0, 4)).toEqual(['Account', 'TCV-SPE', 'ACV-SPE', 'Rev-SPE']);
    expect(within(accountTable).getByText('Total')).toBeInTheDocument();
    expect(within(accountTable).getAllByText('$13.0M').length).toBeGreaterThan(0);
  });
});
