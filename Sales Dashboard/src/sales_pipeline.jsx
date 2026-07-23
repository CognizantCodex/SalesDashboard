import React, { useEffect, useState } from 'react';

const PIPELINE_URL = 'http://127.0.0.1:3001/api/pipeline/summary';
const PIPELINE_CURRENT_URL = 'http://127.0.0.1:3001/api/pipeline/summary/current';
const PIPELINE_UPLOAD_URL = 'http://127.0.0.1:3001/api/pipeline/upload';
const PIPELINE_METADATA_URL = 'http://127.0.0.1:3001/api/pipeline/upload/metadata';

export default function SalesPipeline({ slsName, onSummaryChange, onUploadChange, onResultChange }) {
  const [pipelineWorkbook, setPipelineWorkbook] = useState(null);
  const [savedPipeline, setSavedPipeline] = useState(null);
  const [pipelineSummary, setPipelineSummary] = useState(null);
  const [isPipelineDragging, setIsPipelineDragging] = useState(false);
  const [pipelineError, setPipelineError] = useState('');
  const [isLoadingPipeline, setIsLoadingPipeline] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadSavedPipelineMetadata() {
      try {
        const response = await fetch(PIPELINE_METADATA_URL);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load pipeline upload metadata.');

        if (!ignore && payload.available) {
          setSavedPipeline(payload.database);
        }
      } catch {
        if (!ignore) setSavedPipeline(null);
      }
    }

    loadSavedPipelineMetadata();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const trimmedName = slsName.trim();
    if (!pipelineWorkbook && !savedPipeline?.rowsSaved) {
      setPipelineSummary(null);
      onSummaryChange(null);
      onResultChange(null);
      return undefined;
    }

    if (!trimmedName) {
      setPipelineSummary(null);
      onSummaryChange(null);
      onResultChange(null);
      return undefined;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoadingPipeline(true);
      setPipelineError('');

      try {
        const payload = pipelineWorkbook
          ? await summarizeUploadedPipeline(pipelineWorkbook, trimmedName, controller.signal)
          : await summarizeSavedPipeline(trimmedName, controller.signal);

        setPipelineSummary(payload);
        onSummaryChange(payload);
        onResultChange(payload);
      } catch (err) {
        if (err.name === 'AbortError') return;
        setPipelineSummary(null);
        onSummaryChange(null);
        onResultChange(null);
        setPipelineError(err.message);
      } finally {
        setIsLoadingPipeline(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [pipelineWorkbook, savedPipeline, slsName, onSummaryChange]);

  async function summarizeUploadedPipeline(file, trimmedName, signal) {
    const formData = new FormData();
    formData.append('workbook', file);
    formData.append('slsName', trimmedName);
    formData.append('sheetName', 'Data');
    formData.append('currentYear', String(new Date().getFullYear()));

    const response = await fetch(PIPELINE_URL, {
      method: 'POST',
      body: formData,
      signal
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || 'Pipeline summary failed.');
    return payload;
  }

  async function summarizeSavedPipeline(trimmedName, signal) {
    const params = new URLSearchParams({
      slsName: trimmedName,
      currentYear: String(new Date().getFullYear())
    });
    const response = await fetch(PIPELINE_CURRENT_URL + '?' + params.toString(), { signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || 'Saved pipeline summary failed.');
    if (!payload.available) throw new Error('No saved pipeline upload is available. Upload a pipeline workbook first.');
    return payload;
  }

  async function uploadPipelineWorkbook(file) {
    const formData = new FormData();
    formData.append('workbook', file);
    formData.append('sheetName', 'Data');

    const response = await fetch(PIPELINE_UPLOAD_URL, {
      method: 'POST',
      body: formData
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || 'Pipeline upload failed.');
    return payload.database;
  }

  async function selectPipelineWorkbook(file) {
    if (!file) {
      setPipelineWorkbook(null);
      setPipelineSummary(null);
      onSummaryChange(null);
      onResultChange(null);
      setPipelineError('');
      return;
    }

    const allowed = /\.(xlsb|xlsx|xlsm)$/i.test(file.name);
    if (!allowed) {
      setPipelineWorkbook(null);
      setPipelineSummary(null);
      onSummaryChange(null);
      onResultChange(null);
      setPipelineError('Please select a .xlsb, .xlsx, or .xlsm workbook.');
      return;
    }

    setIsLoadingPipeline(true);
    setPipelineError('');

    try {
      const database = await uploadPipelineWorkbook(file);
      setSavedPipeline(database);
      setPipelineWorkbook(file);
      onUploadChange?.();
    } catch (err) {
      setPipelineWorkbook(null);
      setPipelineSummary(null);
      onSummaryChange(null);
      onResultChange(null);
      setPipelineError(err.message);
    } finally {
      setIsLoadingPipeline(false);
    }
  }

  function handlePipelineDrop(event) {
    event.preventDefault();
    setIsPipelineDragging(false);
    selectPipelineWorkbook(event.dataTransfer.files?.[0]);
  }

  const uploadTitle = pipelineWorkbook
    ? pipelineWorkbook.name
    : savedPipeline?.sourceFilename || 'Drop your pipeline workbook here';

  const uploadSubText = isLoadingPipeline
    ? 'Reading pipeline workbook...'
    : pipelineSummary
      ? pipelineSummary.metrics.rows.toLocaleString() + ' rows summarized for CY ' + pipelineSummary.year
      : savedPipeline?.rowsSaved
        ? savedPipeline.rowsSaved.toLocaleString() + ' rows loaded from pipeline_upload data'
        : 'Supports .xlsb and .xlsx';

  return (
    <section
      className={'upload-card pipeline-upload' + ((pipelineWorkbook || savedPipeline?.rowsSaved) ? ' done' : '') + (isPipelineDragging ? ' drag' : '')}
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
        <p className="upload-title">{uploadTitle}</p>
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
