import { useId } from 'react';
import { formatValue } from './fields';

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
  { key: 'total', label: 'Total', color: '#98dfca' },
  { key: 'pde', label: 'PDE residual', color: '#92b5e7' },
  { key: 'boundary', label: 'Boundary', color: '#e6b586' },
] as const;

export default function TrainingPlot({ history }: { history: LossSample[] }) {
  const titleId = useId();
  const descriptionId = useId();
  if (!history.length)
    return (
      <div className="training-plot-empty">
        <span className="plot-crosshair">+</span>
        <p>Loss curves appear when training starts.</p>
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
        <title id={titleId}>PINN training losses</title>
        <desc id={descriptionId}>
          Measured total, PDE residual, and boundary losses by training step on a logarithmic
          vertical scale. Zero losses lie at the lower plotting limit.
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
                stroke="#35444c"
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
            {item.label}
          </span>
        ))}
        {history.some(
          (sample) => sample.total === 0 || sample.pde === 0 || sample.boundary === 0,
        ) && <small>Zero shown at plotting floor</small>}
      </div>
    </div>
  );
}
