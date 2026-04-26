import React, { useEffect, useState } from 'react';

const PIPELINE_URL = 'http://127.0.0.1:3001/api/pipeline/summary';

export default function SalesPipeline({ slsName, onSummaryChange }) {
  const [pipelineWorkbook, setPipelineWorkbook] = useState(null);
  const [pipelineSummary, setPipelineSummary] = useState(null);
  const [isPipelineDragging, setIsPipelineDragging] = useState(false);
  const [pipelineError, setPipelineError] = useState('');
  const [isLoadingPipeline, setIsLoadingPipeline] = useState(false);

  useEffect(() => {
    if (!pipelineWorkbook) {
      setPipelineSummary(null);
      onSummaryChange(null);
      return undefined;
    }

    const trimmedName = slsName.trim();
    if (!trimmedName) {
      setPipelineSummary(null);
      onSummaryChange(null);
      setPipelineError('Enter an SLS name to summarize pipeline.');
      return undefined;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoadingPipeline(true);
      setPipelineError('');

      const formData = new FormData();
      formData.append('workbook', pipelineWorkbook);
      formData.append('slsName', trimmedName);
      formData.append('sheetName', 'Data');
      formData.append('currentYear', String(new Date().getFullYear()));

      try {
        const response = await fetch(PIPELINE_URL, {
          method: 'POST',
          body: formData,
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || payload.error || 'Pipeline summary failed.');

        setPipelineSummary(payload);
        onSummaryChange(payload);
      } catch (err) {
        if (err.name === 'AbortError') return;
        setPipelineSummary(null);
        onSummaryChange(null);
        setPipelineError(err.message);
      } finally {
        setIsLoadingPipeline(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [pipelineWorkbook, slsName, onSummaryChange]);

  function selectPipelineWorkbook(file) {
    if (!file) {
      setPipelineWorkbook(null);
      setPipelineSummary(null);
      onSummaryChange(null);
      setPipelineError('');
      return;
    }

    const allowed = /\.(xlsb|xlsx|xlsm)$/i.test(file.name);
    if (!allowed) {
      setPipelineWorkbook(null);
      setPipelineSummary(null);
      onSummaryChange(null);
      setPipelineError('Please select a .xlsb, .xlsx, or .xlsm workbook.');
      return;
    }

    setPipelineWorkbook(file);
    setPipelineError('');
  }

  function handlePipelineDrop(event) {
    event.preventDefault();
    setIsPipelineDragging(false);
    selectPipelineWorkbook(event.dataTransfer.files?.[0]);
  }

  const uploadSubText = isLoadingPipeline
    ? 'Reading pipeline workbook...'
    : pipelineSummary
      ? pipelineSummary.metrics.rows.toLocaleString() + ' rows summarized for CY ' + pipelineSummary.year
      : 'Supports .xlsb and .xlsx';

  return (
    <section
      className={'upload-card pipeline-upload' + (pipelineWorkbook ? ' done' : '') + (isPipelineDragging ? ' drag' : '')}
      onDragOver={(event) => {
        event.preventDefault();
        setIsPipelineDragging(true);
      }}
      onDragLeave={() => setIsPipelineDragging(false)}
      onDrop={handlePipelineDrop}
    >
      <label>
        <span className="upload-kicker">Pipeline</span>
        <svg className="upload-icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5m4 5V4" />
        </svg>
        <p className="upload-title">{pipelineWorkbook ? pipelineWorkbook.name : 'Drop your pipeline workbook here'}</p>
        <p className="upload-sub">{uploadSubText}</p>
        {pipelineError && <p className="upload-error">{pipelineError}</p>}
        <input
          type="file"
          accept=".xlsb,.xlsx,.xlsm"
          onChange={(event) => selectPipelineWorkbook(event.target.files?.[0] || null)}
        />
      </label>
    </section>
  );
}
