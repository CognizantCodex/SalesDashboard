import React, { useEffect, useState } from 'react';
import { apiUrl } from './api.js';
import UploadOption from './upload_option.jsx';

const ENTITY_CONFIG = {
  sls: {
    formField: 'slsName',
    summaryUrl: apiUrl('/api/pipeline/summary'),
    currentUrl: apiUrl('/api/pipeline/summary/current'),
    uploadUrl: apiUrl('/api/pipeline/upload'),
    metadataUrl: apiUrl('/api/pipeline/upload/metadata'),
    savedTableLabel: 'pipeline_upload data'
  },
  slsm: {
    formField: 'slsmName',
    summaryUrl: apiUrl('/api/slsm/pipeline/summary'),
    currentUrl: apiUrl('/api/slsm/pipeline/summary/current'),
    uploadUrl: apiUrl('/api/slsm/pipeline/upload'),
    metadataUrl: apiUrl('/api/slsm/pipeline/upload/metadata'),
    savedTableLabel: 'slsm_pipeline_upload data'
  }
};

export default function SalesPipeline({ slsName, onSummaryChange, onUploadChange, onResultChange, entity = 'sls' }) {
  const config = ENTITY_CONFIG[entity] || ENTITY_CONFIG.sls;
  const [pipelineWorkbook, setPipelineWorkbook] = useState(null);
  const [savedPipeline, setSavedPipeline] = useState(null);
  const [pipelineSummary, setPipelineSummary] = useState(null);
  const [pipelineError, setPipelineError] = useState('');
  const [isLoadingPipeline, setIsLoadingPipeline] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadSavedPipelineMetadata() {
      try {
        const response = await fetch(config.metadataUrl);
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
    formData.append(config.formField, trimmedName);
    formData.append('sheetName', 'Data');
    formData.append('currentYear', String(new Date().getFullYear()));

    const response = await fetch(config.summaryUrl, {
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
      [config.formField]: trimmedName,
      currentYear: String(new Date().getFullYear())
    });
    const response = await fetch(config.currentUrl + '?' + params.toString(), { signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || 'Saved pipeline summary failed.');
    if (!payload.available) throw new Error('No saved pipeline upload is available. Upload a pipeline workbook first.');
    return payload;
  }

  async function uploadPipelineWorkbook(file) {
    const formData = new FormData();
    formData.append('workbook', file);
    formData.append('sheetName', 'Data');

    const response = await fetch(config.uploadUrl, {
      method: 'POST',
      body: formData
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || 'Pipeline upload failed.');
    return payload.database;
  }

  async function selectPipelineWorkbook(file, source = 'select') {
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
      setPipelineError('Please ' + (source === 'drop' ? 'drop' : 'select') + ' a .xlsb, .xlsx, or .xlsm workbook.');
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

  const uploadTitle = pipelineWorkbook
    ? pipelineWorkbook.name
    : savedPipeline?.sourceFilename || 'Drop your pipeline workbook here';

  const uploadSubText = isLoadingPipeline
    ? 'Reading pipeline workbook...'
    : pipelineSummary
      ? pipelineSummary.metrics.rows.toLocaleString() + ' rows summarized for CY ' + pipelineSummary.year
      : savedPipeline?.rowsSaved
        ? savedPipeline.rowsSaved.toLocaleString() + ' rows loaded from ' + config.savedTableLabel
        : 'Supports .xlsb and .xlsx';

  return (
    <UploadOption
      className="pipeline-upload"
      label="Pipeline"
      title={uploadTitle}
      subtitle={uploadSubText}
      error={pipelineError}
      icon="pipeline"
      isComplete={Boolean(pipelineWorkbook || savedPipeline?.rowsSaved)}
      onFileSelect={selectPipelineWorkbook}
    />
  );
}
