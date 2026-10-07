/* Generated from contracts/project.schema.json. Run npm run generate. */

export type BoundaryId = string;
/**
 * @minItems 2
 * @maxItems 2
 */
export type Point2 = [number, number];
export type CadFeature =
  | CadImportFeature
  | CadSketchFeature
  | CadBoxFeature
  | CadCylinderFeature
  | CadExtrudeFeature
  | CadRevolveFeature
  | CadBooleanFeature
  | CadTransformFeature
  | CadFilletFeature
  | CadChamferFeature
  | CadLoftFeature
  | CadSweepFeature
  | CadAssemblyFeature;
export type CadSketchEntity = CadSketchLine | CadSketchCircle | CadSketchArc;
export type CadSketchConstraint =
  | CadSketchFixedPointConstraint
  | CadSketchCoincidentConstraint
  | CadSketchDistanceConstraint
  | CadSketchHorizontalConstraint
  | CadSketchVerticalConstraint
  | CadSketchDiameterConstraint
  | CadSketchEqualLengthConstraint
  | CadSketchParallelConstraint
  | CadSketchPerpendicularConstraint
  | CadSketchEqualRadiusConstraint;
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

export interface ProjectDefinition {
  schemaVersion: 7;
  id: string;
  name: string;
  revision: number;
  displayUnits: "m" | "mm";
  geometry: EmptyGeometry | NumericalGeometry | CadGeometry;
  study: null | LinearStaticStudy;
  /**
   * @maxItems 100
   */
  namedSelections: NamedSelection[];
}
export interface EmptyGeometry {
  kind: "empty";
  dimension: "2d" | "3d";
}
export interface NumericalGeometry {
  kind: "box" | "cylinder" | "bracket" | "profile";
  length: number;
  width: number;
  height: number;
  radius: number;
  thickness: number;
  profile?: Profile;
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
export interface CadGeometry {
  kind: "cad";
  dimension: "2d" | "3d";
  /**
   * @minItems 1
   * @maxItems 128
   */
  features: [CadFeature, ...CadFeature[]];
  outputFeatureId: string;
  /**
   * @maxItems 32
   */
  assets: NativeAssetMetadata[];
}
export interface CadImportFeature {
  id: string;
  name: string;
  kind: "import-step";
  assetId: string;
  scaleFactor: number;
}
export interface CadSketchFeature {
  id: string;
  name: string;
  kind: "sketch";
  plane: "xy" | "xz" | "yz";
  sketch: CadSketchDefinition;
  purpose?: "profile" | "path";
}
export interface CadSketchDefinition {
  /**
   * @maxItems 256
   */
  points: CadSketchPoint[];
  /**
   * @maxItems 256
   */
  entities: CadSketchEntity[];
  /**
   * @maxItems 512
   */
  constraints: CadSketchConstraint[];
  /**
   * @maxItems 64
   */
  loops: CadSketchLoop[];
}
export interface CadSketchPoint {
  id: string;
  position: Point2;
}
export interface CadSketchLine {
  id: string;
  name: string;
  kind: "line";
  startId: string;
  endId: string;
}
export interface CadSketchCircle {
  id: string;
  name: string;
  kind: "circle";
  centerId: string;
  radius: number;
}
export interface CadSketchArc {
  id: string;
  name: string;
  kind: "arc";
  centerId: string;
  startId: string;
  endId: string;
  clockwise: boolean;
}
export interface CadSketchFixedPointConstraint {
  id: string;
  kind: "fixedPoint";
  pointId: string;
}
export interface CadSketchCoincidentConstraint {
  id: string;
  kind: "coincident";
  firstPointId: string;
  secondPointId: string;
}
export interface CadSketchDistanceConstraint {
  id: string;
  kind: "distance";
  firstPointId: string;
  secondPointId: string;
  value: number;
}
export interface CadSketchHorizontalConstraint {
  id: string;
  kind: "horizontal";
  lineId: string;
}
export interface CadSketchVerticalConstraint {
  id: string;
  kind: "vertical";
  lineId: string;
}
export interface CadSketchDiameterConstraint {
  id: string;
  kind: "diameter";
  curveId: string;
  value: number;
}
export interface CadSketchEqualLengthConstraint {
  id: string;
  kind: "equalLength";
  firstLineId: string;
  secondLineId: string;
}
export interface CadSketchParallelConstraint {
  id: string;
  kind: "parallel";
  firstLineId: string;
  secondLineId: string;
}
export interface CadSketchPerpendicularConstraint {
  id: string;
  kind: "perpendicular";
  firstLineId: string;
  secondLineId: string;
}
export interface CadSketchEqualRadiusConstraint {
  id: string;
  kind: "equalRadius";
  firstCurveId: string;
  secondCurveId: string;
}
export interface CadSketchLoop {
  id: string;
  /**
   * @minItems 1
   * @maxItems 256
   */
  entityIds: [string, ...string[]];
  role: "outer" | "hole";
}
export interface CadBoxFeature {
  id: string;
  name: string;
  kind: "box";
  length: number;
  width: number;
  height: number;
}
export interface CadCylinderFeature {
  id: string;
  name: string;
  kind: "cylinder";
  radius: number;
  length: number;
}
export interface CadExtrudeFeature {
  id: string;
  name: string;
  kind: "extrude";
  sketchId: string;
  distance: number;
}
export interface CadRevolveFeature {
  id: string;
  name: string;
  kind: "revolve";
  sketchId: string;
  /**
   * @minItems 3
   * @maxItems 3
   */
  axisOrigin: [number, number, number];
  /**
   * @minItems 3
   * @maxItems 3
   */
  axisDirection: [number, number, number];
  angle: number;
}
export interface CadBooleanFeature {
  id: string;
  name: string;
  kind: "boolean";
  operation: "union" | "cut" | "intersect";
  leftId: string;
  rightId: string;
}
export interface CadTransformFeature {
  id: string;
  name: string;
  kind: "transform";
  inputId: string;
  /**
   * @minItems 3
   * @maxItems 3
   */
  translation: [number, number, number];
  /**
   * @minItems 3
   * @maxItems 3
   */
  axisOrigin: [number, number, number];
  /**
   * @minItems 3
   * @maxItems 3
   */
  axisDirection: [number, number, number];
  angle: number;
}
export interface CadFilletFeature {
  id: string;
  name: string;
  kind: "fillet";
  inputId: string;
  /**
   * @minItems 1
   * @maxItems 100
   */
  edgeIds: [string, ...string[]];
  radius: number;
}
export interface CadChamferFeature {
  id: string;
  name: string;
  kind: "chamfer";
  inputId: string;
  /**
   * @minItems 1
   * @maxItems 100
   */
  edgeIds: [string, ...string[]];
  distance: number;
}
export interface CadLoftFeature {
  id: string;
  name: string;
  kind: "loft";
  /**
   * @minItems 2
   * @maxItems 16
   */
  sectionIds: [string, string, ...string[]];
  solid: boolean;
  ruled: boolean;
}
export interface CadSweepFeature {
  id: string;
  name: string;
  kind: "sweep";
  profileId: string;
  spineId: string;
  solid: boolean;
}
export interface CadAssemblyFeature {
  id: string;
  name: string;
  kind: "assembly";
  /**
   * @minItems 1
   * @maxItems 32
   */
  components: [CadAssemblyComponent, ...CadAssemblyComponent[]];
}
export interface CadAssemblyComponent {
  id: string;
  name: string;
  featureId: string;
}
export interface NativeAssetMetadata {
  id: string;
  kind: "step-source";
  originalName: string;
  sha256: string;
  byteLength: number;
}
export interface LinearStaticStudy {
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
  formulation: "strong-form" | "potential-energy";
}
export interface NamedSelection {
  id: string;
  name: string;
  geometryKind: "box" | "cylinder" | "bracket" | "profile";
  dimension: "2d" | "3d";
  regions: Regions;
}
