import schema from '../../../contracts/project.schema.json';
import type { NumericalGeometry } from '../contracts/types';
import { profileError } from '../project/profile';

type Node = {
  type?: string;
  enum?: unknown[];
  $ref?: string;
  required?: string[];
  properties?: Record<string, Node>;
  additionalProperties?: boolean;
  items?: Node;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
};
const definitions = schema.definitions as unknown as Record<string, Node>;

/** Bounded interpretation of the canonical numerical geometry subtree; no runtime compilation. */
export function assertCadNumericalGeometry(value: unknown): asserts value is NumericalGeometry {
  let budget = 2048;
  const valid = (item: unknown, node: Node, depth = 0): boolean => {
    if (--budget < 0 || depth > 12) return false;
    if (node.$ref) {
      const name = node.$ref.replace('#/definitions/', '');
      return !!definitions[name] && valid(item, definitions[name], depth + 1);
    }
    if (node.enum && !node.enum.includes(item)) return false;
    if (node.type === 'object') {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const object = item as Record<string, unknown>;
      if (node.required?.some((key) => !Object.hasOwn(object, key))) return false;
      return Object.entries(object).every(([key, child]) =>
        node.properties?.[key]
          ? valid(child, node.properties[key], depth + 1)
          : node.additionalProperties !== false,
      );
    }
    if (node.type === 'array')
      return (
        Array.isArray(item) &&
        item.length >= (node.minItems ?? 0) &&
        item.length <= (node.maxItems ?? 256) &&
        !!node.items &&
        item.every((child) => valid(child, node.items!, depth + 1))
      );
    if (node.type === 'number')
      return (
        typeof item === 'number' &&
        Number.isFinite(item) &&
        item >= (node.minimum ?? -Infinity) &&
        item > (node.exclusiveMinimum ?? -Infinity) &&
        item <= (node.maximum ?? Infinity)
      );
    if (node.type === 'string')
      return (
        typeof item === 'string' &&
        item.length >= (node.minLength ?? 0) &&
        item.length <= (node.maxLength ?? 1000) &&
        (!node.pattern || new RegExp(node.pattern).test(item))
      );
    if (node.type === 'boolean') return typeof item === 'boolean';
    return true;
  };
  if (!valid(value, definitions.NumericalGeometry))
    throw new Error('Invalid CAD numerical geometry projection.');
  const geometry = value as NumericalGeometry;
  if (geometry.kind === 'profile' && profileError(geometry.profile))
    throw new Error('Invalid CAD plane-profile projection.');
  if (
    geometry.kind === 'bracket' &&
    geometry.thickness >= Math.min(geometry.length, geometry.width)
  )
    throw new Error('Invalid CAD bracket projection.');
}
