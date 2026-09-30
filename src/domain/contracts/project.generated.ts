/* Generated from contracts/project.schema.json. Run npm run generate. */

/**
 * @minItems 1
 * @maxItems 20
 */
export type Regions = [
  "x0" | "x1" | "y0" | "y1" | "z0" | "z1" | "outer" | "inner-x" | "inner-y",
  ...("x0" | "x1" | "y0" | "y1" | "z0" | "z1" | "outer" | "inner-x" | "inner-y")[]
];
/**
 * @minItems 3
 * @maxItems 3
 */
export type Vector = [number, number, number];

export interface Project {
  schemaVersion: 3;
  id: string;
  name: string;
  revision: number;
  displayUnits: "m" | "mm";
  geometry: {
    kind: "box" | "cylinder" | "bracket";
    length: number;
    width: number;
    height: number;
    radius: number;
    thickness: number;
  };
  study: {
    id: string;
    type: "linear-static";
    material: {
      name: string;
      young: number;
      poisson: number;
    };
    mesh: {
      size: number;
    };
    /**
     * @maxItems 100
     */
    constraints: Constraint[];
    /**
     * @maxItems 100
     */
    loads: Load[];
    dimension: "2d" | "3d";
    formulation: "plane-stress" | "solid";
    thickness: number;
    solver: {
      kind: "fem" | "pinn";
      pinn: PinnConfiguration;
    };
  };
  /**
   * @maxItems 100
   */
  namedSelections: NamedSelection[];
}
export interface Constraint {
  id: string;
  name: string;
  regions: Regions;
  /**
   * @minItems 3
   * @maxItems 3
   */
  components: [number | null, number | null, number | null];
}
export interface Load {
  id: string;
  name: string;
  regions: Regions;
  kind: "force" | "pressure";
  vector: Vector;
  pressure: number;
}
export interface PinnConfiguration {
  layers: number;
  width: number;
  activation: "tanh";
  optimizer: "adam";
  learningRate: number;
  steps: number;
  interiorPoints: number;
  boundaryPoints: number;
  seed: number;
  device: "auto" | "cpu" | "mps" | "cuda";
}
export interface NamedSelection {
  id: string;
  name: string;
  geometryKind: "box" | "cylinder" | "bracket";
  dimension: "2d" | "3d";
  regions: Regions;
}
