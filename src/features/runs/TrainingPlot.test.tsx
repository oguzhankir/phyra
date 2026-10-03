import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TrainingPlot, { EnergyPlot, energyDomain } from './TrainingPlot';

it('frames a signed potential on a linear axis with zero preserved', () => {
  const history = [
    { step: 0, potential: 0.5, strain: 1, work: 0.5 },
    { step: 10, potential: -0.75, strain: 0.75, work: 1.5 },
  ];
  const domain = energyDomain(history);
  expect(domain.minimum).toBeCloseTo(-0.81);
  expect(domain.maximum).toBeCloseTo(0.56);
  const markup = renderToStaticMarkup(<EnergyPlot history={history} />);
  expect(markup).toContain('Signed potential-energy objective');
  expect(markup).toContain('linear vertical scale');
  expect(markup).toContain('Negative values and zero crossings retain their sign');
  expect(markup).toContain('-0.81');
  expect(markup).not.toMatch(/NaN|Infinity/);
});
it('handles zero and extreme finite signed plotting ranges without invalid SVG coordinates', () => {
  expect(energyDomain([{ step: 0, potential: 0, strain: 0, work: 0 }])).toEqual({
    minimum: -1,
    maximum: 1,
  });
  const markup = renderToStaticMarkup(
    <EnergyPlot
      history={[
        { step: 0, potential: -Number.MAX_VALUE, strain: 0, work: Number.MAX_VALUE },
        { step: 1, potential: Number.MAX_VALUE, strain: Number.MAX_VALUE, work: 0 },
      ]}
    />,
  );
  expect(markup).not.toMatch(/NaN|Infinity/);
});
it('labels residual curves as diagnostics for energy optimization', () => {
  const markup = renderToStaticMarkup(
    <TrainingPlot diagnostics history={[{ step: 0, total: 1, pde: 0.8, boundary: 0.2 }]} />,
  );
  expect(markup).toContain('PINN residual diagnostics');
  expect(markup).toContain('Diagnostic total');
  expect(markup).toContain('separate signed objective');
});
