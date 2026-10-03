import { useId } from 'react';
import { formatValue } from '../../domain/units';
import type { TrainingEnergy } from '../../domain/contracts/types';

export type LossSample = {
  step: number;
  total: number;
  pde: number;
  boundary: number;
  elapsedSeconds?: number;
};
export function lossDomain(history: LossSample[]): {
  minimum: number;
  maximum: number;
  floor: number;
} {
  const positive = history
    .flatMap((sample) => [sample.total, sample.pde, sample.boundary])
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!positive.length) return { minimum: -12, maximum: 0, floor: 1e-12 };
  const floor = Math.min(...positive) / 10;
  const minimum = Math.floor(
    Math.log10(
      history.some((sample) => sample.total === 0 || sample.pde === 0 || sample.boundary === 0)
        ? floor
        : Math.min(...positive),
    ),
  );
  const maximum = Math.max(minimum + 1, Math.ceil(Math.log10(Math.max(...positive)))) || 0;
  return { minimum, maximum, floor: 10 ** minimum };
}
const series = [
  { key: 'total', label: 'Total', color: 'var(--plot-total)' },
  { key: 'pde', label: 'PDE residual', color: 'var(--plot-pde)' },
  { key: 'boundary', label: 'Boundary', color: 'var(--plot-boundary)' },
] as const;

export default function TrainingPlot({
  history,
  diagnostics = false,
}: {
  history: LossSample[];
  diagnostics?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  if (!history.length)
    return (
      <div className="training-plot-empty">
        <span className="plot-crosshair">+</span>
        <p>
          {diagnostics
            ? 'Residual diagnostics appear when training starts.'
            : 'Loss curves appear when training starts.'}
        </p>
        <small>Real PDE and boundary residuals · logarithmic scale</small>
      </div>
    );
  const domain = lossDomain(history);
  const left = 59;
  const top = 14;
  const width = 548;
  const height = 128;
  const maximumStep = Math.max(1, ...history.map((sample) => sample.step));
  const x = (step: number) => left + (step / maximumStep) * width;
  const y = (value: number) =>
    top +
    ((domain.maximum - Math.log10(Math.max(domain.floor, value))) /
      (domain.maximum - domain.minimum)) *
      height;
  return (
    <div className="training-plot">
      <svg
        viewBox="0 0 628 171"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        preserveAspectRatio="none"
      >
        <title id={titleId}>
          {diagnostics ? 'PINN residual diagnostics' : 'PINN training losses'}
        </title>
        <desc id={descriptionId}>
          Measured total, PDE residual, and boundary losses by training step on a logarithmic
          vertical scale. Zero losses lie at the lower plotting limit.
          {diagnostics
            ? ' These residuals are diagnostics; the potential-energy optimizer uses a separate signed objective.'
            : ''}
        </desc>
        {Array.from({ length: 4 }, (_, index) => {
          const exponent = domain.maximum - ((domain.maximum - domain.minimum) * index) / 3;
          const yy = top + (height * index) / 3;
          return (
            <g key={index}>
              <line
                x1={left}
                y1={yy}
                x2={left + width}
                y2={yy}
                stroke="var(--line)"
                strokeDasharray="2 5"
              />
              <text x={left - 9} y={yy + 3} textAnchor="end">
                {formatValue(10 ** exponent)}
              </text>
            </g>
          );
        })}
        {series.map((item) => (
          <path
            key={item.key}
            d={history
              .filter((sample) => Number.isFinite(sample[item.key]) && sample[item.key] >= 0)
              .map(
                (sample, index) =>
                  `${index ? 'L' : 'M'}${x(sample.step).toFixed(2)},${y(sample[item.key]).toFixed(2)}`,
              )
              .join(' ')}
            fill="none"
            stroke={item.color}
            strokeWidth={item.key === 'total' ? 2 : 1.3}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <text x={left} y={top + height + 20}>
          0
        </text>
        <text x={left + width} y={top + height + 20} textAnchor="end">
          Step {maximumStep.toLocaleString()}
        </text>
      </svg>
      <div className="plot-legend">
        {series.map((item) => (
          <span key={item.key}>
            <i style={{ background: item.color }} />
            {diagnostics && item.key === 'total' ? 'Diagnostic total' : item.label}
          </span>
        ))}
        {history.some(
          (sample) => sample.total === 0 || sample.pde === 0 || sample.boundary === 0,
        ) && <small>Zero shown at plotting floor</small>}
      </div>
    </div>
  );
}

/** The signed potential is plotted directly on a linear axis, including its zero crossing. */
export function energyDomain(history: TrainingEnergy['history']) {
  const values = history.map((sample) => sample.potential).filter(Number.isFinite);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const margin = Math.max(Math.abs(minimum), Math.abs(maximum)) * 0.08 || 1;
  return {
    minimum: Math.max(-Number.MAX_VALUE, minimum - margin),
    maximum: Math.min(Number.MAX_VALUE, maximum + margin),
  };
}

export function EnergyPlot({ history }: { history: TrainingEnergy['history'] }) {
  const titleId = useId();
  const descriptionId = useId();
  if (!history.length) return null;
  const domain = energyDomain(history);
  const magnitude = Math.max(Math.abs(domain.minimum), Math.abs(domain.maximum));
  const normalizedMinimum = domain.minimum / magnitude;
  const normalizedMaximum = domain.maximum / magnitude;
  const left = 59,
    top = 14,
    width = 548,
    height = 128;
  const maximumStep = Math.max(1, ...history.map((sample) => sample.step));
  const x = (step: number) => left + (step / maximumStep) * width;
  const y = (value: number) =>
    top +
    ((normalizedMaximum - value / magnitude) / (normalizedMaximum - normalizedMinimum)) * height;
  return (
    <div className="training-plot energy-plot">
      <svg
        viewBox="0 0 628 171"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        preserveAspectRatio="none"
      >
        <title id={titleId}>Signed potential-energy objective</title>
        <desc id={descriptionId}>
          Measured dimensionless potential, strain energy minus boundary external work, by
          optimization step on a linear vertical scale. Negative values and zero crossings retain
          their sign. These values are separate from residual diagnostics and do not prove field
          accuracy.
        </desc>
        {Array.from({ length: 5 }, (_, index) => {
          const value =
            (normalizedMaximum + ((normalizedMinimum - normalizedMaximum) * index) / 4) * magnitude;
          const yy = top + (height * index) / 4;
          return (
            <g key={index}>
              <line
                x1={left}
                y1={yy}
                x2={left + width}
                y2={yy}
                stroke="var(--line)"
                strokeDasharray="2 5"
              />
              <text x={left - 9} y={yy + 3} textAnchor="end">
                {formatValue(value)}
              </text>
            </g>
          );
        })}
        <line x1={left} y1={y(0)} x2={left + width} y2={y(0)} stroke="var(--border-strong)" />
        <path
          d={history
            .filter((sample) => Number.isFinite(sample.potential))
            .map(
              (sample, index) =>
                `${index ? 'L' : 'M'}${x(sample.step).toFixed(2)},${y(sample.potential).toFixed(2)}`,
            )
            .join(' ')}
          fill="none"
          stroke="var(--plot-total)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <text x={left} y={top + height + 20}>
          0
        </text>
        <text x={left + width} y={top + height + 20} textAnchor="end">
          Step {maximumStep.toLocaleString()}
        </text>
      </svg>
      <div className="plot-legend">
        <span>
          <i style={{ background: 'var(--plot-total)' }} />
          Potential · dimensionless · linear scale
        </span>
      </div>
    </div>
  );
}
