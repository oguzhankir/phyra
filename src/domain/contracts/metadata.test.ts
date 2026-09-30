import { describe, expect, it } from 'vitest';
import schema from '../../../contracts/engine-capabilities.schema.json';
import { makeProject } from '../../features/examples/projects';
import { assertCapabilities, assertTrainingMetadata } from './metadata';
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
