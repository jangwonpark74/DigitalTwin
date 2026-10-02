// Shared axes for the React and template drive-measurement charts.
export function dmTrendScale(samples, spec) {
  const values = samples.map(sample => sample[spec.key]).filter(Number.isFinite);
  const padding = spec.unit === 'Mbps' ? 4 : 5;
  const low = Math.min(...values, spec.poor) - padding;
  const high = Math.max(...values, spec.good) + padding;
  const targetStep = (high - low) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const step = [1, 2, 5, 10].find(value => value * magnitude >= targetStep) * magnitude;
  const minimum = spec.unit === 'Mbps' ? Math.max(0, Math.floor(low / step) * step) : Math.floor(low / step) * step;
  const maximum = Math.ceil(high / step) * step;
  const ticks = Array.from({ length: Math.round((maximum - minimum) / step) + 1 }, (_, index) => minimum + index * step);
  const plot = { left: 56, right: 920, top: 24, bottom: 204 };
  const x = index => plot.left + (plot.right - plot.left) * index / Math.max(1, samples.length - 1);
  const y = value => plot.bottom - (plot.bottom - plot.top) * (value - minimum) / (maximum - minimum);
  const sampleTicks = samples.length ? [...new Set(Array.from({ length: 5 }, (_, index) => Math.round((samples.length - 1) * index / 4)))] : [];
  const stride = Math.max(1, Math.ceil(samples.length / 500));
  const observations = samples.length ? [...new Set([...Array.from({ length: Math.ceil(samples.length / stride) }, (_, index) => index * stride), samples.length - 1])] : [];
  return { minimum, maximum, step, ticks, sampleTicks, observations, plot, x, y };
}
