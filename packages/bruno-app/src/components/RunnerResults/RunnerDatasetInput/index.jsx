import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { IconFileSpreadsheet, IconX } from '@tabler/icons';
import { transport } from 'utils/common/ipc-transport';
import Button from 'ui/Button';

const RunnerDatasetInput = ({ dataset, onChange, disabled = false, className = '' }) => {
  const [loading, setLoading] = useState(false);

  const selectDataset = async () => {
    setLoading(true);
    try {
      const result = await transport.invoke('renderer:load-runner-dataset');
      if (result) onChange(result);
    } catch (error) {
      toast.error(error?.message || 'Unable to load the dataset file');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className} data-testid="runner-dataset-input">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} loading={loading} onClick={selectDataset}>
          {dataset ? 'Replace Dataset' : 'Select Dataset File'}
        </Button>
        {dataset && (
          <button
            type="button"
            className="p-1 text-muted cursor-pointer"
            aria-label="Clear dataset"
            title="Clear dataset"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <IconX size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {dataset ? (
        <div className="mt-2 flex items-start gap-2 text-xs">
          <IconFileSpreadsheet size={18} strokeWidth={1.5} className="flex-shrink-0" />
          <div className="min-w-0">
            <div className="font-medium truncate" title={dataset.filePath}>{dataset.fileName}</div>
            <div className="text-muted">
              {dataset.rows.length} iteration{dataset.rows.length === 1 ? '' : 's'} · {dataset.columns.length} variable{dataset.columns.length === 1 ? '' : 's'}
            </div>
            {dataset.columns.length > 0 && (
              <div className="text-muted truncate mt-1" title={dataset.columns.join(', ')}>
                Variables: {dataset.columns.map((name) => `{{${name}}}`).join(', ')}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2 text-xs text-muted">
          Optional JSON or CSV file. Each data row runs the selected requests once and overrides matching runtime variables.
        </div>
      )}
    </div>
  );
};

export default RunnerDatasetInput;
