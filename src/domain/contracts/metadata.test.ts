import { describe, expect, it } from 'vitest';
import schema from '../../../contracts/engine-capabilities.schema.json';
import { makeProject } from '../../features/examples/projects';
import { assertCapabilities, assertTrainingMetadata, assertReferenceMetadata } from './metadata';
import type { Manifest } from './types';
function schemaValue(node: unknown): unknown {
  const item = node as Record<string, unknown>;
  if (Object.hasOwn(item, 'const')) return item.const;
  if (item.type === 'object')
    return Object.fromEntries(
      Object.entries(item.properties as Record<string, unknown>).map(([key, value]) => [
        key,
        schemaValue(value),
      ]),
    );
  if (item.type === 'array')
    return Array.isArray(item.items) ? item.items.map(schemaValue) : [schemaValue(item.items)];
  if (item.type === 'string') return 'Available CPU';
  if (item.type === 'boolean') return false;
  return 1;
}
describe('versioned engine metadata', () => {
  it('accepts only the implemented method registry and bounded device information', () => {
    const capabilities = schemaValue(schema) as {
      methods: { framework: string; devices: { label: string }[] }[];
    };
    expect(() => assertCapabilities(capabilities)).not.toThrow();
    capabilities.methods[2].framework = 'unsupported';
    expect(() => assertCapabilities(capabilities)).toThrow('capability metadata');
  });
  it('rejects extra metadata and oversized values without dynamic schema compilation', () => {
    const capabilities = schemaValue(schema) as { methods: { devices: { label: string }[] }[] };
    capabilities.methods[0].devices[0].label = 'x'.repeat(101);
    expect(() => assertCapabilities(capabilities)).toThrow();
    expect(() => assertCapabilities({ ...(schemaValue(schema) as object), cloud: true })).toThrow();
  });
  it('keeps old caches valid and independently sampled diagnostics tied to their configuration', () => {
    const configuration = makeProject('plane-stress-tension').study.solver.pinn;
    const manifest = { training: { configuration } } as Manifest;
    expect(() => assertTrainingMetadata(manifest)).not.toThrow();
    manifest.training!.validation = {
      schemaVersion: 1,
      sampling: 'independent-uniform',
      seed: configuration.seed ^ 0x5eed5eed,
      interiorPoints: configuration.interiorPoints,
      boundaryPointsPerRegion: configuration.boundaryPoints,
      total: 0.002,
      pde: 0.001,
      boundary: 0.001,
      displacement: 0.0005,
      traction: 0.0005,
    };
    expect(() => assertTrainingMetadata(manifest)).not.toThrow();
    manifest.training!.validation.seed = configuration.seed;
    expect(() => assertTrainingMetadata(manifest)).toThrow('independent-point');
    manifest.training!.validation.seed = configuration.seed ^ 0x5eed5eed;
    manifest.training!.validation.pde = NaN;
    expect(() => assertTrainingMetadata(manifest)).toThrow();
  });
});

describe('independent analytical diagnostics', () => {
  it('keeps field units and zero-reference definitions explicit while rejecting nonfinite metrics', () => {
    const manifest = {
      dimension: '2d',
      operation: 'solve',
      solver: 'fem',
      reference: {
        kind: 'kirsch-plane-stress',
        source: 'https://doi.org/10.1016/j.finel.2026.104523',
        mapping: 'area-weighted at identical points',
        quadratureOrder: 5,
        displacement: { relativeL2: 0.002, maxAbsolute: 1e-7, referenceNorm: 1e-4 },
        stress: { relativeL2: 0.02, maxAbsolute: 0.03, referenceNorm: 1 },
        holeTraction: { rms: 0.05, relativeRms: 0.1, maxAbsolute: 0.08 },
        parameters: { radius: 1, center: [0, 0], tension: 0.5, young: 1e5, poisson: 0.3 },
      },
    } as Manifest;
    expect(() => assertReferenceMetadata(manifest)).not.toThrow();
    manifest.reference!.displacement.relativeL2 = NaN;
    expect(() => assertReferenceMetadata(manifest)).toThrow('analytical-reference');
    manifest.reference!.displacement = { relativeL2: null, maxAbsolute: 0, referenceNorm: 0 };
    expect(() => assertReferenceMetadata(manifest)).not.toThrow();
    manifest.reference!.displacement.relativeL2 = 0;
    expect(() => assertReferenceMetadata(manifest)).toThrow();
  });
});

describe('signed energy objectives and separate integral audits', () => {
  function fixture(): Manifest {
    const configuration = {
      ...makeProject('plane-stress-tension').study.solver.pinn,
      formulation: 'potential-energy' as const,
      steps: 2,
      interiorPoints: 8,
      boundaryPoints: 4,
      layers: 1,
      width: 4,
    };
    return {
      jobId: 'energy-job',
      operation: 'train',
      dimension: '2d',
      solver: 'pinn',
      thickness: 0.002,
      training: {
        configuration,
        precision: 'float64',
        device: 'cpu',
        timings: { trainingSeconds: 2, inferenceSeconds: 0.1 },
        normalization: { stress: 1e6, displacement: 1e-6, length: 0.1 },
        history: [0, 1, 2].map((step) => ({
          jobId: 'energy-job',
          step,
          elapsed: step,
          total: 1,
          pde: 0.8,
          boundary: 0.2,
          device: 'cpu',
        })),
        energy: {
          schemaVersion: 1,
          definition: 'Potential = strain minus external work',
          trainingQuadrature: 'Weighted triangle and edge quadrature',
          auditQuadrature: 'Finer weighted triangle and edge quadrature',
          interiorPoints: 12,
          boundaryPoints: 32,
          physicalScale: 0.0002,
          history: [
            { step: 0, potential: 0, strain: 0, work: 0 },
            { step: 1, potential: -0.5, strain: 0.5, work: 1 },
            { step: 2, potential: -0.75, strain: 0.75, work: 1.5 },
          ],
          audit: { potential: -0.7421875, strain: 0.7578125, work: 1.5 },
          relativeIntegrationDifference: 1 / 192,
        },
      },
    } as unknown as Manifest;
  }
  it('accepts signed potentials without turning nonnegative residuals into an energy objective', () => {
    expect(() => assertTrainingMetadata(fixture())).not.toThrow();
    const value = fixture();
    value.training!.history[1].total = -0.5;
    expect(() => assertTrainingMetadata(value)).toThrow('potential-energy');
  });
  it('rejects a missing energy record for the energy method and an energy claim by strong-form training', () => {
    const missing = fixture();
    delete missing.training!.energy;
    expect(() => assertTrainingMetadata(missing)).toThrow('potential-energy');
    const strong = fixture();
    strong.training!.configuration.formulation = 'strong-form';
    expect(() => assertTrainingMetadata(strong)).toThrow('potential-energy');
  });
  it.each(['potential', 'strain', 'work'] as const)('rejects nonfinite %s measurements', (key) => {
    const value = fixture();
    value.training!.energy!.audit[key] = Infinity;
    expect(() => assertTrainingMetadata(value)).toThrow('potential-energy');
  });
  it('checks the energy identity and separate audit difference', () => {
    const inconsistent = fixture();
    inconsistent.training!.energy!.history[1].potential = -2;
    expect(() => assertTrainingMetadata(inconsistent)).toThrow('potential-energy');
    const negativeStrain = fixture();
    negativeStrain.training!.energy!.audit.strain = -1;
    expect(() => assertTrainingMetadata(negativeStrain)).toThrow('potential-energy');
    const wrongAudit = fixture();
    wrongAudit.training!.energy!.relativeIntegrationDifference = 0;
    expect(() => assertTrainingMetadata(wrongAudit)).toThrow('potential-energy');
  });
  it('rejects a quadrature discrepancy above the 1% publication limit', () => {
    const value = fixture();
    value.training!.energy!.audit = { potential: -0.625, strain: 0.875, work: 1.5 };
    value.training!.energy!.relativeIntegrationDifference = 1 / 12;
    expect(() => assertTrainingMetadata(value)).toThrow('potential-energy');
  });
  it('binds objective steps to owned residual history and validates physical units', () => {
    const wrongJob = fixture();
    wrongJob.training!.history[1].jobId = 'previous';
    expect(() => assertTrainingMetadata(wrongJob)).toThrow('potential-energy');
    const wrongStep = fixture();
    wrongStep.training!.energy!.history[1].step = 0;
    expect(() => assertTrainingMetadata(wrongStep)).toThrow('potential-energy');
    const wrongScale = fixture();
    wrongScale.training!.energy!.physicalScale *= 1000;
    expect(() => assertTrainingMetadata(wrongScale)).toThrow('potential-energy');
  });
  it('bounds provenance text, history and the joint quadrature resource count', () => {
    const oversizedText = fixture();
    oversizedText.training!.energy!.definition = 'x'.repeat(1001);
    expect(() => assertTrainingMetadata(oversizedText)).toThrow('potential-energy');
    const oversizedHistory = fixture();
    oversizedHistory.training!.energy!.history = Array(1002).fill(
      oversizedHistory.training!.energy!.history[0],
    );
    expect(() => assertTrainingMetadata(oversizedHistory)).toThrow('potential-energy');
    const oversizedQuadrature = fixture();
    oversizedQuadrature.training!.energy!.interiorPoints = 1e6;
    expect(() => assertTrainingMetadata(oversizedQuadrature)).toThrow('potential-energy');
    const unexpectedKey = fixture();
    Object.assign(unexpectedKey.training!.energy!.audit, { certifiedAccuracy: true });
    expect(() => assertTrainingMetadata(unexpectedKey)).toThrow('potential-energy');
  });
});
