/* Generated from contracts/engine-capabilities.schema.json. Run npm run generate. */

export interface EngineCapabilities {
  schemaVersion: 2;
  execution: {
    backend: "local-process";
    jobsPerWorker: 1;
    cancellation: "terminate-worker";
  };
  /**
   * @minItems 1
   * @maxItems 1
   */
  materialModels: ["homogeneous-isotropic-linear-elastic"];
  /**
   * @minItems 4
   * @maxItems 4
   */
  meshing: [
    {
      id: "gmsh-occ-tetra4";
      dimension: "3d";
      cellType: "tetra4";
      /**
       * @minItems 3
       * @maxItems 3
       */
      geometryKinds: ["box", "cylinder", "bracket"];
    },
    {
      id: "structured-rectangle-tri3";
      dimension: "2d";
      cellType: "triangle3";
      /**
       * @minItems 1
       * @maxItems 1
       */
      geometryKinds: ["box"];
    },
    {
      id: "gmsh-occ-profile-tri3";
      dimension: "2d";
      cellType: "triangle3";
      /**
       * @minItems 1
       * @maxItems 1
       */
      geometryKinds: ["profile"];
    },
    {
      id: "gmsh-occ-cad-tetra4";
      dimension: "3d";
      cellType: "tetra4";
      /**
       * @minItems 1
       * @maxItems 1
       */
      geometryKinds: ["cad"];
      requiredDomain: "cad-solid";
    }
  ];
  /**
   * @minItems 4
   * @maxItems 4
   */
  methods: [
    {
      id: "fem-solid-tetra4";
      kind: "fem";
      dimension: "3d";
      formulation: "solid";
      framework: "scipy";
      operation: "solve";
      configuration: null;
      /**
       * @minItems 1
       * @maxItems 1
       */
      devices: [
        {
          id: "cpu";
          label: string;
          precision: "float64";
          available: true;
          reason: string;
        }
      ];
    },
    {
      id: "fem-plane-stress-tri3";
      kind: "fem";
      dimension: "2d";
      formulation: "plane-stress";
      framework: "scikit-fem";
      operation: "solve";
      configuration: null;
      /**
       * @minItems 1
       * @maxItems 1
       */
      devices: [
        {
          id: "cpu";
          label: string;
          precision: "float64";
          available: true;
          reason: string;
        }
      ];
    },
    {
      id: "pinn-plane-stress-displacement";
      kind: "pinn";
      dimension: "2d";
      formulation: "plane-stress";
      framework: "pytorch";
      operation: "train";
      configuration: "study.solver.pinn";
      /**
       * @minItems 3
       * @maxItems 3
       */
      devices: [
        {
          id: "cpu";
          label: string;
          precision: "float64";
          available: boolean;
          reason: string;
        },
        {
          id: "mps";
          label: string;
          precision: "float32";
          available: boolean;
          reason: string;
        },
        {
          id: "cuda";
          label: string;
          precision: "float64";
          available: boolean;
          reason: string;
        }
      ];
    },
    {
      id: "pinn-plane-stress-energy";
      kind: "pinn";
      dimension: "2d";
      formulation: "plane-stress";
      framework: "pytorch";
      operation: "train";
      configuration: "study.solver.pinn";
      /**
       * @minItems 3
       * @maxItems 3
       */
      devices: [
        {
          id: "cpu";
          label: string;
          precision: "float64";
          available: boolean;
          reason: string;
        },
        {
          id: "mps";
          label: string;
          precision: "float32";
          available: boolean;
          reason: string;
        },
        {
          id: "cuda";
          label: string;
          precision: "float64";
          available: boolean;
          reason: string;
        }
      ];
    }
  ];
  /**
   * @minItems 2
   * @maxItems 2
   */
  comparisons: [
    {
      id: "plane-stress-fem-pinn";
      operation: "compare";
      reference: "fem-plane-stress-tri3";
      prediction: "pinn-plane-stress-displacement";
      mapping: "identical nodes and cell centroids; unweighted relative L2";
    },
    {
      id: "plane-stress-fem-energy-pinn";
      operation: "compare";
      reference: "fem-plane-stress-tri3";
      prediction: "pinn-plane-stress-energy";
      mapping: "identical nodes and cell centroids; unweighted relative L2";
    }
  ];
}
