import schema from '../../../contracts/engine-capabilities.schema.json';
import type { EngineCapabilities } from './capabilities.generated';
import type { Manifest } from './types';
type SchemaNode = {
  type?: string;
  const?: unknown;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean;
  items?: SchemaNode | SchemaNode[];
  additionalItems?: boolean;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
};
function assertSchema(
  value: unknown,
  node: SchemaNode,
  path: string,
  budget: { remaining: number },
  depth = 0,
): void {
  if (--budget.remaining < 0 || depth > 12)
    throw new Error('Capability metadata exceeds validation bounds.');
  const invalid = () => {
    throw new Error(`Invalid capability metadata: ${path}.`);
  };
  if (Object.hasOwn(node, 'const') && JSON.stringify(value) !== JSON.stringify(node.const))
    invalid();
  if (node.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const object = value as Record<string, unknown>;
    if (node.required?.some((key) => !Object.hasOwn(object, key))) invalid();
    for (const [key, item] of Object.entries(object)) {
      const child = node.properties?.[key];
      if (!child) {
        if (node.additionalProperties === false) invalid();
        continue;
      }
      assertSchema(item, child, `${path}.${key}`, budget, depth + 1);
    }
  } else if (node.type === 'array') {
    if (!Array.isArray(value)) invalid();
    const array = value as unknown[];
    if (array.length < (node.minItems ?? 0) || array.length > (node.maxItems ?? 1000)) invalid();
    array.forEach((item, index) => {
      const child = Array.isArray(node.items) ? node.items[index] : node.items;
      if (!child) {
        if (node.additionalItems === false) invalid();
        return;
      }
      assertSchema(item, child, `${path}[${index}]`, budget, depth + 1);
    });
  } else if (node.type === 'string') {
    if (
      typeof value !== 'string' ||
      value.length < (node.minLength ?? 0) ||
      value.length > (node.maxLength ?? 8192)
    )
      invalid();
  } else if (node.type === 'integer') {
    if (!Number.isSafeInteger(value)) invalid();
  } else if (node.type === 'boolean') {
    if (typeof value !== 'boolean') invalid();
  }
}
export function assertCapabilities(value: unknown): asserts value is EngineCapabilities {
  assertSchema(value, schema as SchemaNode, 'capabilities', { remaining: 1000 });
}
export function assertTrainingMetadata(manifest: Manifest): void {
  const training = manifest.training;
  const value = training?.validation;
  if (!value) return;
  const keys = [
    'schemaVersion',
    'sampling',
    'seed',
    'interiorPoints',
    'boundaryPointsPerRegion',
    'total',
    'pde',
    'boundary',
    'displacement',
    'traction',
  ];
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    value.schemaVersion !== 1 ||
    value.sampling !== 'independent-uniform' ||
    value.seed !== (training!.configuration.seed ^ 0x5eed5eed) ||
    value.interiorPoints !== training!.configuration.interiorPoints ||
    value.boundaryPointsPerRegion !== training!.configuration.boundaryPoints ||
    ![value.total, value.pde, value.boundary, value.displacement, value.traction].every(
      (item) => Number.isFinite(item) && item >= 0,
    )
  )
    throw new Error('Invalid independent-point residual metadata.');
}

export function assertReferenceMetadata(manifest: Manifest): void {
  const reference = manifest.reference;
  if (reference === undefined) return;
  const invalid = () => {
    throw new Error('Invalid independent analytical-reference metadata.');
  };
  const keys = (value: unknown, expected: string[]) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== expected.length ||
      expected.some((key) => !Object.hasOwn(value, key))
    )
      invalid();
  };
  keys(reference, [
    'kind',
    'source',
    'mapping',
    'quadratureOrder',
    'displacement',
    'stress',
    'holeTraction',
    'parameters',
  ]);
  if (
    manifest.dimension !== '2d' ||
    manifest.operation !== 'solve' ||
    manifest.solver !== 'fem' ||
    reference.kind !== 'kirsch-plane-stress' ||
    reference.quadratureOrder !== 5 ||
    reference.source !== 'https://doi.org/10.1016/j.finel.2026.104523' ||
    typeof reference.mapping !== 'string' ||
    reference.mapping.length > 1000
  )
    invalid();
  const metric = (value: typeof reference.displacement) => {
    keys(value, ['relativeL2', 'maxAbsolute', 'referenceNorm']);
    if (
      ![value.maxAbsolute, value.referenceNorm].every(
        (item) => Number.isFinite(item) && item >= 0,
      ) ||
      (value.referenceNorm === 0
        ? value.relativeL2 !== null
        : value.relativeL2 === null || !Number.isFinite(value.relativeL2) || value.relativeL2 < 0)
    )
      invalid();
  };
  metric(reference.displacement);
  metric(reference.stress);
  keys(reference.parameters, ['radius', 'center', 'tension', 'young', 'poisson']);
  const p = reference.parameters;
  if (
    !(p.radius > 0 && p.radius <= 1000) ||
    !(p.young > 0 && p.young <= 1e15) ||
    !(p.poisson > -1 && p.poisson <= 0.45) ||
    !Number.isFinite(p.tension) ||
    !Array.isArray(p.center) ||
    p.center.length !== 2 ||
    p.center.some((item) => !Number.isFinite(item) || Math.abs(item) > 1000)
  )
    invalid();
  const hole = reference.holeTraction;
  keys(hole, ['rms', 'relativeRms', 'maxAbsolute']);
  if (
    ![hole.rms, hole.maxAbsolute].every((item) => Number.isFinite(item) && item >= 0) ||
    (p.tension === 0
      ? hole.relativeRms !== null
      : hole.relativeRms === null || !Number.isFinite(hole.relativeRms) || hole.relativeRms < 0)
  )
    invalid();
}
