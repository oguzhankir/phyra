import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Select from './Select';
import DetailDialog from './DetailDialog';

describe('shared selection and detail controls', () => {
  it('connects its visible label and selected option to an accessible combobox', () => {
    const markup = renderToStaticMarkup(
      <Select
        id="device"
        label="Training device"
        value="cpu"
        options={[{ value: 'cpu', label: 'CPU · float64' }]}
        onChange={() => {}}
      />,
    );
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-labelledby="device-label"');
    expect(markup).toContain('for="device"');
    expect(markup).toContain('CPU · float64');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('<select');
  });
  it('keeps a disabled saved choice visible and honors disabled control state', () => {
    const markup = renderToStaticMarkup(
      <Select
        aria-label="Model"
        value="saved"
        disabled
        options={[{ value: 'saved', label: 'Saved model · unavailable', disabled: true }]}
        onChange={() => {}}
      />,
    );
    expect(markup).toContain('Saved model · unavailable');
    expect(markup).toContain('aria-label="Model"');
    expect(markup).toContain('disabled=""');
  });
  it('opens secondary information through a dialog action without a disclosure triangle', () => {
    const markup = renderToStaticMarkup(
      <DetailDialog title="Execution details">
        <p>Exact run identity</p>
      </DetailDialog>,
    );
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('Execution details');
    expect(markup).not.toContain('<details');
  });
});
