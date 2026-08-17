import React, { useEffect, useRef, useState } from 'react';
import { apiUrl } from './api.js';
import UploadOption from './upload_option.jsx';

const ENTITY_CONFIG = {
  sls: {
    formField: 'slsName',
    summaryUrl: apiUrl('/api/pipeline/summary'),
    currentUrl: apiUrl('/api/pipeline/summary/current'),
    uploadUrl: apiUrl('/api/pipeline/upload'),
    metadataUrl: apiUrl('/api/pipeline/upload/metadata'),
    insuranceUploadUrl: apiUrl('/api/pipeline/insurance/upload'),
    insuranceMetadataUrl: apiUrl('/api/pipeline/insurance/upload/metadata'),
    savedTableLabel: 'pipeline_upload data'
  },
  slsm: {
    formField: 'slsmName',
    summaryUrl: apiUrl('/api/slsm/pipeline/summary'),
    currentUrl: apiUrl('/api/slsm/pipeline/summary/current'),
    uploadUrl: apiUrl('/api/slsm/pipeline/upload'),
    metadataUrl: apiUrl('/api/slsm/pipeline/upload/metadata'),
    insuranceUploadUrl: apiUrl('/api/pipeline/insurance/upload'),
    insuranceMetadataUrl: apiUrl('/api/pipeline/insurance/upload/metadata'),
    savedTableLabel: 'slsm_pipeline_upload data'
  }
};

export default function SalesPipeline({ slsName, onSummaryChange, onUploadChange, onResultChange, entity = 'sls' }) {
  const config = ENTITY_CONFIG[entity] || ENTITY_CONFIG.sls;
  const [pipelineWorkbook, setPipelineWorkbook] = useState(null);
  const [insuranceWorkbook, setInsuranceWorkbook] = useState(null);
  const [savedPipeline, setSavedPipeline] = useState(null);
  const [savedInsurancePipeline, setSavedInsurancePipeline] = useState(null);
  const [pipelineSummary, setPipelineSummary] = useState(null);
  const [pipelineError, setPipelineError] = useState('');
  const [insurancePipelineError, setInsurancePipelineError] = useState('');
  const [isLoadingPipeline, setIsLoadingPipeline] = useState(false);
  const summaryCache = useRef(new Map());

  useEffect(() => {
    let ignore = false;

    async function loadSavedPipelineMetadata() {
      try {
        const [response, insuranceResponse] = await Promise.all([
          fetch(config.metadataUrl),
          fetch(config.insuranceMetadataUrl)
        ]);
        const [payload, insurancePayload] = await Promise.all([response.json(), insuranceResponse.json()]);
        if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load pipeline upload metadata.');

        if (!ignore && payload.available) {
          setSavedPipeline(payload.database);
        }
        if (!ignore && insuranceResponse.ok && insurancePayload.available) setSavedInsurancePipeline(insurancePayload.database);
      } catch {
        if (!ignore) {
          setSavedPipeline(null);
          setSavedInsurancePipeline(null);
        }
      }
    }

    loadSavedPipelineMetadata();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const trimmedName = slsName.trim();
    if (!pipelineWorkbook && !insuranceWorkbook && !savedPipeline?.rowsSaved && !savedInsurancePipeline?.rowsSaved) {
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

    const cacheKey = [
      entity,
      trimmedName.toLocaleLowerCase(),
      savedPipeline?.sourceFilename || '',
      savedInsurancePipeline?.sourceFilename || ''
    ].join('|');
    const cachedSummary = summaryCache.current.get(cacheKey);
    if (cachedSummary) {
      setPipelineSummary(cachedSummary);
      onSummaryChange(cachedSummary);
      onResultChange(cachedSummary);
      setPipelineError('');
      return undefined;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoadingPipeline(true);
      setPipelineError('');

      try {
        const payload = await summarizeSavedPipeline(trimmedName, controller.signal);

        summaryCache.current.set(cacheKey, payload);
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
  }, [pipelineWorkbook, insuranceWorkbook, savedPipeline, savedInsurancePipeline, slsName, onSummaryChange]);

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

  async function uploadPipelineWorkbook(file, uploadUrl = config.uploadUrl) {
    const formData = new FormData();
    formData.append('workbook', file);
    formData.append('sheetName', 'Data');

    const response = await fetch(uploadUrl, {
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
      summaryCache.current.clear();
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

  async function selectInsurancePipelineWorkbook(file, source = 'select') {
    if (!file) {
      setInsuranceWorkbook(null);
      setInsurancePipelineError('');
      return;
    }

    const allowed = /\.(xlsb|xlsx|xlsm)$/i.test(file.name);
    if (!allowed) {
      setInsuranceWorkbook(null);
      setInsurancePipelineError('Please ' + (source === 'drop' ? 'drop' : 'select') + ' an Insurance .xlsb, .xlsx, or .xlsm workbook.');
      return;
    }

    setIsLoadingPipeline(true);
    setInsurancePipelineError('');
    try {
      const database = await uploadPipelineWorkbook(file, config.insuranceUploadUrl);
      summaryCache.current.clear();
      setSavedInsurancePipeline(database);
      setInsuranceWorkbook(file);
      onUploadChange?.();
    } catch (err) {
      setInsuranceWorkbook(null);
      setInsurancePipelineError(err.message);
    } finally {
      setIsLoadingPipeline(false);
    }
  }

  const uploadTitle = pipelineWorkbook
    ? pipelineWorkbook.name
    : savedPipeline?.sourceFilename || 'Drop your pipeline workbook here';

  const uploadSubText = isLoadingPipeline
    ? 'Updating the selected SLS from saved pipeline records...'
    : pipelineSummary
      ? pipelineSummary.metrics.rows.toLocaleString() + ' rows summarized for CY ' + pipelineSummary.year
      : savedPipeline?.rowsSaved
        ? savedPipeline.rowsSaved.toLocaleString() + ' rows loaded from ' + config.savedTableLabel
        : 'Supports .xlsb and .xlsx';
  const insuranceUploadTitle = insuranceWorkbook
    ? insuranceWorkbook.name
    : savedInsurancePipeline?.sourceFilename || 'Drop your Insurance pipeline workbook here';
  const insuranceUploadSubText = isLoadingPipeline
    ? 'Updating the selected SLS from saved pipeline records...'
    : savedInsurancePipeline?.rowsSaved
      ? savedInsurancePipeline.rowsSaved.toLocaleString() + ' Insurance rows merged with pipeline data'
      : 'Supports .xlsb and .xlsx';

  return (
    <>
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
      <UploadOption
        className="pipeline-upload insurance-pipeline-upload"
        label="Insurance Pipeline"
        title={insuranceUploadTitle}
        subtitle={insuranceUploadSubText}
        error={insurancePipelineError}
        icon="pipeline"
        isComplete={Boolean(insuranceWorkbook || savedInsurancePipeline?.rowsSaved)}
        onFileSelect={selectInsurancePipelineWorkbook}
      />
    </>
  );
}
