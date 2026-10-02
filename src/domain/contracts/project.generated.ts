/* Generated from contracts/project.schema.json. Run npm run generate. */

export type BoundaryId = string;
/**
 * @minItems 2
 * @maxItems 2
 */
export type Point2 = [number, number];
/**
 * @minItems 1
 * @maxItems 80
 */
export type Regions = [BoundaryId, ...BoundaryId[]];
/**
 * @minItems 3
 * @maxItems 3
 */
export type Vector = [number, number, number];

export interface Project {
  schemaVersion: 4;
  id: string;
  name: string;
  revision: number;
  displayUnits: "m" | "mm";
  geometry: {
    kind: "box" | "cylinder" | "bracket" | "profile";
    length: number;
    width: number;
    height: number;
    radius: number;
    thickness: number;
    profile?: Profile;
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
      boundarySize?: number;
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
export interface Profile {
  /**
   * @minItems 2
   * @maxItems 64
   */
  outer: [ProfileSegment, ProfileSegment, ...ProfileSegment[]];
  /**
   * @maxItems 16
   */
  holes: ProfileHole[];
}
export interface ProfileSegment {
  id: BoundaryId;
  name: string;
  kind: "line" | "arc";
  start: Point2;
  end: Point2;
  center?: Point2;
  clockwise?: boolean;
}
export interface ProfileHole {
  id: BoundaryId;
  name: string;
  center: Point2;
  radius: number;
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
  kind: "force" | "pressure" | "traction";
  vector: Vector;
  pressure: number;
  traction?: AffineTraction | KirschTraction;
}
export interface AffineTraction {
  kind: "affine";
  xx: Vector;
  yy: Vector;
  xy: Vector;
}
export interface KirschTraction {
  kind: "kirsch";
  radius: number;
  center: Point2;
  tension: number;
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
  geometryKind: "box" | "cylinder" | "bracket" | "profile";
  dimension: "2d" | "3d";
  regions: Regions;
}
