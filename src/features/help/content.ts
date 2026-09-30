export type HelpContext =
  | 'overview'
  | 'geometry'
  | 'material'
  | 'conditions'
  | 'constraints'
  | 'loads'
  | 'mesh'
  | 'study'
  | 'solver'
  | 'results'
  | 'runs'
  | 'files';

export const helpCategories = ['Get started', 'Prepare', 'Solve', 'Inspect', 'Reference'] as const;
export type HelpCategory = (typeof helpCategories)[number];
export type HelpArticleId =
  | 'first-study'
  | 'geometry'
  | 'material'
  | 'study'
  | 'supports'
  | 'loads'
  | 'mesh'
  | 'solver'
  | 'fem-3d'
  | 'fem-2d'
  | 'pinn'
  | 'devices'
  | 'comparison'
  | 'results'
  | 'runs'
  | 'files'
  | 'units'
  | 'errors'
  | 'scope';

export interface HelpSection {
  title: string;
  paragraphs?: readonly string[];
  steps?: readonly string[];
  bullets?: readonly string[];
  facts?: readonly { label: string; value: string }[];
  note?: { tone: 'info' | 'warning'; text: string };
}

export interface HelpArticle {
  id: HelpArticleId;
  title: string;
  summary: string;
  category: HelpCategory;
  kind: 'Guide' | 'Method' | 'Reference';
  experimental?: boolean;
  keywords: readonly string[];
  sections: readonly HelpSection[];
  related: readonly HelpArticleId[];
}

export const helpArticles: readonly HelpArticle[] = [
  {
    id: 'first-study',
    title: 'Run your first study',
    summary: 'Prepare a physical problem, solve it locally, and inspect a current result.',
    category: 'Get started',
    kind: 'Guide',
    keywords: ['workflow', 'start', 'example', 'project', 'navigation', 'offline'],
    sections: [
      {
        title: 'From model to results',
        steps: [
          'Open an example for a complete starting problem, or create a new project and add its supports and loads.',
          'Set the study dimension, geometry and one isotropic material. Check the length units before entering values.',
          'Select boundaries in the viewport or boundary list. Define support components and total force or pressure.',
          'Choose a mesh size and generate the mesh. Inspect the element count and minimum quality.',
          'Run Classical FEM. Inspect deformation, physical fields, reactions and balance before drawing conclusions.',
          'Save the project. Export physical fields when you need authoritative SI values outside the workbench.',
        ],
      },
      {
        title: 'Try Physics ML next',
        paragraphs: [
          'Open Plane stress · tension, run its FEM reference, then select Physics ML · PINN or Compare FEM / PINN. Comparison evaluates both methods at shared physical locations.',
        ],
        note: {
          tone: 'warning',
          text: 'PINN is experimental. A completed training run or low loss does not establish engineering accuracy.',
        },
      },
      {
        title: 'Inspect a saved reference in the browser',
        paragraphs: [
          'Use Inspect 3D reference or Inspect 2D comparison to load recorded CPU results. Select result sources and fields, then probe values in the viewport.',
          'These references contain saved fields, training history and run provenance. Loading one starts no numerical worker. Editing physical inputs makes its fields stale; use the desktop application to mesh, solve, train and use native project files.',
        ],
      },
    ],
    related: ['study', 'supports', 'results'],
  },
  {
    id: 'geometry',
    title: 'Define geometry and select boundaries',
    summary: 'Edit supported primitives and assign conditions to named geometric boundaries.',
    category: 'Prepare',
    kind: 'Guide',
    keywords: ['box', 'cylinder', 'bracket', 'rectangle', 'face', 'edge', 'selection', 'dimension'],
    sections: [
      {
        title: 'Supported domains',
        bullets: [
          '3D: a box, an X-axis cylinder, or a connected L bracket. Bracket thickness must be smaller than both in-plane dimensions.',
          '2D: a rectangle in the X–Y plane. Physical thickness belongs to the study; it is not a third layer of solid elements.',
          'A cylinder spans X = 0 to length, with its axis centered at Y = Z = 0.',
        ],
      },
      {
        title: 'Assign the intended boundary',
        steps: [
          'Select a face in 3D or an edge in 2D, then inspect its boundary name. Use the boundary list if a face is hard to reach.',
          'Create or edit a support/load and check its assigned boundaries. One assignment may include several boundaries.',
          'Review assignments after changing the primitive or study dimension: those changes clear incompatible conditions.',
        ],
        note: {
          tone: 'info',
          text: 'Boundary identifiers describe geometry and persist through remeshing. New input values make the previous solution stale.',
        },
      },
    ],
    related: ['supports', 'loads', 'units'],
  },
  {
    id: 'material',
    title: 'Set the isotropic material',
    summary: 'Young’s modulus and Poisson’s ratio define the current linear elastic material.',
    category: 'Prepare',
    kind: 'Guide',
    keywords: ['young', 'modulus', 'poisson', 'elasticity', 'GPa', 'material', 'stiffness'],
    sections: [
      {
        title: 'What the inputs mean',
        facts: [
          {
            label: 'Young’s modulus E',
            value: 'Elastic stiffness. The material editor displays GPa; 1 GPa = 10⁹ Pa.',
          },
          {
            label: 'Poisson’s ratio ν',
            value: 'Dimensionless transverse response. The supported range is −1 < ν ≤ 0.45.',
          },
          {
            label: 'Material name',
            value:
              'A descriptive label. Changing the name does not choose properties from a certified database.',
          },
        ],
      },
      {
        title: 'Check the assumptions',
        paragraphs: [
          'One homogeneous isotropic material applies to the entire domain. Use positive, finite modulus and properties appropriate to small strains. Example properties are editable demonstration inputs.',
        ],
        note: {
          tone: 'warning',
          text: 'Plasticity, temperature dependence, anisotropy, multiple materials and nearly incompressible behavior are outside this release.',
        },
      },
    ],
    related: ['study', 'fem-3d', 'fem-2d'],
  },
  {
    id: 'study',
    title: 'Choose the study and formulation',
    summary: 'Select 3D solid elasticity or true 2D plane stress before defining conditions.',
    category: 'Prepare',
    kind: 'Guide',
    keywords: ['study', 'dimension', 'plane stress', 'thickness', 'solid', 'solver', 'physics'],
    sections: [
      {
        title: 'Available formulations',
        facts: [
          {
            label: '3D solid',
            value:
              'Three displacement components in a connected solid. Classical FEM is available.',
          },
          {
            label: '2D plane stress',
            value:
              'In-plane displacement in a rectangle with explicit physical thickness. FEM and experimental PINN are available.',
          },
          {
            label: 'Linear static',
            value:
              'Small-strain isotropic elasticity in equilibrium. There is no time-dependent or inertial response.',
          },
        ],
      },
      {
        title: 'Changing the study',
        paragraphs: [
          'Changing dimension clears supports and loads. Recheck geometry, thickness and assignments before solving. In 2D, supports act on X/Y components and force has no Z component.',
        ],
        note: {
          tone: 'info',
          text: 'Choose Classical FEM for a reference solution. Choose PINN only for the supported 2D formulation; use Compare to assess its actual fields.',
        },
      },
    ],
    related: ['fem-3d', 'fem-2d', 'pinn'],
  },
  {
    id: 'supports',
    title: 'Restrain or prescribe displacement',
    summary: 'A checked component prescribes a value; an unchecked component stays free.',
    category: 'Prepare',
    kind: 'Guide',
    keywords: [
      'support',
      'boundary conditions',
      'constraint',
      'fixed',
      'roller',
      'rigid body',
      'under constrained',
      'nonzero',
      'displacement',
    ],
    sections: [
      {
        title: 'Define a support',
        steps: [
          'Select the intended boundaries, add a support, and inspect its assigned boundary list.',
          'Choose Fixed to prescribe all available displacement components to zero, or Components to edit them independently.',
          'Check a component to prescribe zero or a nonzero displacement in the displayed length unit. Leave it unchecked to permit motion in that global direction.',
        ],
      },
      {
        title: 'Keep the problem physically defined',
        bullets: [
          'Supports must remove free rigid translation and rotation. The engine reports under-constrained problems instead of adding hidden restraints.',
          'Overlapping assignments must agree on each prescribed component. A shared corner node can belong to more than one boundary.',
          'Free lateral components allow Poisson contraction. Fixing them changes the physical problem.',
        ],
        note: {
          tone: 'warning',
          text: 'Supports use global X/Y/Z axes. A component restraint on a curved wall is not automatically a restraint normal to that wall.',
        },
      },
    ],
    related: ['loads', 'units', 'errors'],
  },
  {
    id: 'loads',
    title: 'Apply total force or pressure',
    summary: 'Choose the physical quantity, sign and assigned boundary area carefully.',
    category: 'Prepare',
    kind: 'Guide',
    keywords: [
      'load',
      'force',
      'pressure',
      'traction',
      'N',
      'Pa',
      'sign',
      'normal',
      'boundary conditions',
    ],
    sections: [
      {
        title: 'Distributed total force',
        paragraphs: [
          'Enter one global vector in newtons. It is the total force across all boundaries in this load, not a separate force per face or node. The engine distributes it by area in 3D and by edge length × physical thickness in 2D.',
          'For example, assigning a 100 N force to two equal-area faces applies 100 N in total. Separate load assignments add their contributions.',
        ],
      },
      {
        title: 'Boundary pressure',
        paragraphs: [
          'Enter pressure in pascals. Positive pressure acts inward, opposite the outward boundary normal; negative pressure acts outward. On a curved boundary, its direction follows the local normal.',
          'The same pressure applies to every assigned boundary. Its integrated force depends on physical area; in 2D that area is edge length × study thickness.',
        ],
        note: {
          tone: 'info',
          text: '1 Pa = 1 N/m². Pressure remains in Pa when the length display switches to millimetres.',
        },
      },
    ],
    related: ['supports', 'units', 'results'],
  },
  {
    id: 'mesh',
    title: 'Generate and check the mesh',
    summary: 'Resolution and element shape affect accuracy in different ways.',
    category: 'Prepare',
    kind: 'Guide',
    keywords: [
      'mesh',
      'quality',
      'convergence',
      'refinement',
      'tetrahedron',
      'triangle',
      'resource limit',
      'bending',
    ],
    sections: [
      {
        title: 'Before solving',
        steps: [
          'Choose a positive target element size in the displayed length unit, then generate the mesh.',
          'Inspect the surface, node/cell counts and minimum quality. Confirm that boundaries and thin features are represented.',
          'Refine the size and repeat a solve to check a quantity that matters, such as displacement. A quality score alone does not establish accuracy.',
        ],
      },
      {
        title: 'Read minimum quality',
        paragraphs: [
          'The score describes the worst element shape. A regular tetrahedron or equilateral triangle scores 1; nearly degenerate elements approach 0. 3D uses tetrahedral mean ratio; 2D uses normalized triangle area divided by squared edge lengths.',
        ],
        note: {
          tone: 'warning',
          text: 'Linear tetrahedra can be stiff in bending. Corner/restraint stress peaks may grow with refinement; inspect meaningful quantities and locations instead of treating every peak as a converged value.',
        },
      },
      {
        title: 'If the mesh is too large',
        paragraphs: [
          'This release limits meshes to 12,000 nodes and 50,000 cells, with additional boundary/buffer limits. Increase the target size or simplify the supported geometry. There are no local refinement or higher-order controls yet.',
        ],
      },
    ],
    related: ['fem-3d', 'fem-2d', 'errors'],
  },
  {
    id: 'solver',
    title: 'Choose and run a numerical method',
    summary: 'Use FEM for the reference problem, then evaluate experimental PINN where supported.',
    category: 'Solve',
    kind: 'Guide',
    keywords: ['solver', 'run', 'solve', 'FEM', 'PINN', 'classical', 'method', 'compare'],
    sections: [
      {
        title: 'Choose an available method',
        steps: [
          'Check the study dimension and formulation. Classical FEM supports both current 3D solid and 2D plane-stress problems.',
          'For rectangular 2D plane stress, select Physics ML · PINN to expose network, sampling, step and device settings.',
          'Run the selected method, or use Compare FEM / PINN to solve both on the same physical problem.',
          'Inspect the run status, actual fields and warnings. A completed run is not a substitute for an accuracy check.',
        ],
      },
      {
        title: 'Separate three checks',
        bullets: [
          'Physical model: geometry, material and conditions describe the intended problem.',
          'Numerical result: refinement, equilibrium and reference comparisons establish accuracy within that model.',
          'Learning result: PINN losses, field differences and measured reactions establish what that training run achieved.',
        ],
      },
    ],
    related: ['fem-3d', 'fem-2d', 'pinn', 'comparison'],
  },
  {
    id: 'fem-3d',
    title: 'Classical FEM · 3D solids',
    summary: 'A sparse finite-element reference for supported linear elastic solids.',
    category: 'Solve',
    kind: 'Method',
    keywords: ['FEM', '3D', 'classical', 'equations', 'tetra4', 'solid', 'stress', 'strain', 'CPU'],
    sections: [
      {
        title: 'Physical and numerical model',
        paragraphs: [
          'The model enforces static equilibrium, ∇ · σ = 0, with linear isotropic stress–strain response and small strain ε = (∇u + ∇uᵀ)/2. Surface loads and prescribed displacement define the supported problem.',
          'First-order tetrahedra interpolate nodal displacement linearly. Stress is constant within each element and transported without smoothing. A local CPU sparse solve computes displacement; reactions are recovered at prescribed components.',
        ],
      },
      {
        title: 'Use and limitations',
        bullets: [
          'Use displacement, stress, reactions and force/moment balance together. Numerical equilibrium is a consistency check, not proof that the modeling assumptions match reality.',
          'Refine for bending or local gradients. The formulation does not include contact, plasticity, large deformation, thermal strain or dynamics.',
        ],
      },
    ],
    related: ['material', 'mesh', 'results'],
  },
  {
    id: 'fem-2d',
    title: 'Classical FEM · 2D plane stress',
    summary: 'An in-plane model with physical thickness, not a thin 3D mesh.',
    category: 'Solve',
    kind: 'Method',
    keywords: [
      'FEM',
      '2D',
      'plane stress',
      'thickness',
      'triangle3',
      'out of plane',
      'plane strain',
    ],
    sections: [
      {
        title: 'What plane stress means',
        paragraphs: [
          'The rectangle lies in X–Y. The model assumes σzz = τyz = τxz = 0 and solves Ux/Uy. Out-of-plane strain may still occur; plane stress is not plane strain.',
          'Constant-strain triangles provide the FEM discretization. Thickness scales stiffness, edge-load area and strain energy. It is an explicit physical input, not a display setting.',
        ],
      },
      {
        title: 'Set up and inspect',
        steps: [
          'Choose 2D plane stress and enter positive thickness.',
          'Define X/Y support components and in-plane total force or pressure on rectangle edges.',
          'Run FEM and inspect in-plane displacement, cell stress and reactions. Export uses common three-component displacement/six-component stress layouts with unused out-of-plane fields zero.',
        ],
      },
    ],
    related: ['study', 'loads', 'comparison'],
  },
  {
    id: 'pinn',
    title: 'Physics ML · displacement PINN',
    summary: 'Train an experimental 2D elasticity network from equations and conditions.',
    category: 'Solve',
    kind: 'Method',
    experimental: true,
    keywords: [
      'PINN',
      'physics ML',
      'neural network',
      'training',
      'loss',
      'PDE',
      'Adam',
      'tanh',
      'seed',
    ],
    sections: [
      {
        title: 'What is trained',
        paragraphs: [
          'A displacement network learns the supported rectangular plane-stress problem. Automatic differentiation evaluates equilibrium and boundary terms; training does not use FEM displacement labels. Prescribed displacement is enforced through the network construction and remaining physical conditions enter training losses.',
        ],
      },
      {
        title: 'Choose a bounded training run',
        bullets: [
          'Layers and width set network capacity. This release uses tanh activation and Adam optimization.',
          'Learning rate controls parameter updates; steps set the training budget. Interior and boundary points set equation/condition sampling.',
          'The seed fixes the initialization and sampling configuration. Record actual device and precision when comparing runs.',
          'Live total, PDE and boundary losses are dimensionless training measurements. A smaller loss alone does not guarantee accurate fields or balanced reactions.',
        ],
      },
      {
        title: 'Evaluate the result',
        paragraphs: [
          'Use Compare FEM / PINN to inspect same-location errors and measured force/moment imbalance. Additional steps or a larger network may help, but improvement must be checked against the actual fields. Each run trains from its seed; saved weights are not resumed.',
        ],
        note: {
          tone: 'warning',
          text: 'PINN is available only for rectangular 2D plane stress. It is a numerical learning method, not a chat assistant or a guarantee of faster solving.',
        },
      },
    ],
    related: ['devices', 'comparison', 'runs'],
  },
  {
    id: 'devices',
    title: 'Select a training device',
    summary: 'Use actual capability and precision metadata, not a hardware label alone.',
    category: 'Solve',
    kind: 'Guide',
    keywords: ['device', 'CPU', 'GPU', 'MPS', 'CUDA', 'auto', 'float64', 'float32', 'unavailable'],
    sections: [
      {
        title: 'Available choices',
        facts: [
          {
            label: 'Auto',
            value: 'Chooses CPU float64 for stable derivatives on these small problems.',
          },
          { label: 'CPU', value: 'Float64 training. Classical FEM also runs on CPU.' },
          {
            label: 'MPS',
            value:
              'Apple GPU float32, after an actual derivative/backpropagation capability check.',
          },
          {
            label: 'CUDA',
            value:
              'Requires compatible installed runtime and hardware. Detection is not a verification claim; this target remains unverified.',
          },
        ],
      },
      {
        title: 'If a device is unavailable',
        paragraphs: [
          'Refresh the device inventory and read its reported reason. Selecting an unavailable explicit device fails; choose Auto or CPU to run locally. The portable Windows runtime defaults to CPU.',
          'Training results retain the actual device and precision. Converting transported fields to float64 does not restore precision lost during float32 training.',
        ],
      },
    ],
    related: ['pinn', 'comparison', 'errors'],
  },
  {
    id: 'comparison',
    title: 'Compare FEM and PINN fields',
    summary: 'Compare shared samples, measured errors and both methods’ physical checks.',
    category: 'Inspect',
    kind: 'Guide',
    keywords: [
      'compare',
      'difference',
      'relative L2',
      'absolute',
      'zero',
      'reference',
      'mapping',
      'norm',
    ],
    sections: [
      {
        title: 'Shared physical locations',
        paragraphs: [
          'Compare solves the same 2D problem with FEM and PINN. Displacements are evaluated at the same nodes; stress and von Mises values are evaluated at the same cell centroids.',
          'The reported relative L2 is ‖PINN − FEM‖₂ / ‖FEM‖₂, an unweighted norm over matched samples. Maximum absolute displacement/stress differences use vector/tensor component norms; von Mises uses the scalar absolute difference.',
        ],
      },
      {
        title: 'Read the contours and diagnostics',
        bullets: [
          'Switch among FEM, PINN, absolute difference and relative difference. The legend and probe follow the selected source.',
          'Relative values are undefined when the reference norm is zero. Per-location relative contours omit zero-reference locations; an omitted value is not zero error.',
          'Inspect PINN reactions and force/moment imbalance separately from FEM equilibrium. A successful comparison can contain an inaccurate learned result.',
          'Training and inference times are separate from FEM time. One quick inference does not account for training cost.',
        ],
      },
    ],
    related: ['pinn', 'results', 'runs'],
  },
  {
    id: 'results',
    title: 'Inspect fields and deformation',
    summary: 'Use the legend, field association and physical checks to interpret results.',
    category: 'Inspect',
    kind: 'Guide',
    keywords: [
      'results',
      'contour',
      'legend',
      'probe',
      'von Mises',
      'stress',
      'deformation',
      'animation',
      'reaction',
      'balance',
    ],
    sections: [
      {
        title: 'Field and probe meaning',
        facts: [
          {
            label: 'Displacement',
            value:
              'Nodal displacement. A surface probe reports the nearest surface node, not a new interpolated solution.',
          },
          {
            label: 'Stress / von Mises',
            value:
              'Element fields. FEM stress is unsmoothed and constant per first-order element; the probe identifies its cell.',
          },
          {
            label: 'Deformation',
            value:
              'Actual scale preserves physical displacement. Amplified scale makes small displacements visible without changing authoritative data.',
          },
          {
            label: 'Play',
            value:
              'Cycles the scale of a static solution. It does not simulate time, inertia or vibration.',
          },
        ],
      },
      {
        title: 'Before trusting a result',
        bullets: [
          'Check that the result is current, uses the intended method and has the correct units.',
          'Inspect total force, reaction, force/moment balance and any warnings. PINN balance is approximate and must be assessed independently.',
          'Check refinement and model assumptions. Idealized supports or re-entrant corners can create singular stress peaks.',
        ],
      },
    ],
    related: ['comparison', 'mesh', 'files'],
  },
  {
    id: 'runs',
    title: 'Track runs, losses and cancellation',
    summary: 'Run metadata identifies what was executed and which fields belong to it.',
    category: 'Inspect',
    kind: 'Guide',
    keywords: [
      'run',
      'progress',
      'elapsed',
      'duration',
      'metrics',
      'cancel',
      'stale',
      'provenance',
      'job',
    ],
    sections: [
      {
        title: 'Read the run workspace',
        paragraphs: [
          'Inspect operation, status, input configuration, duration and actual device. During PINN training, the plot shows real measured total/PDE/boundary losses and step history for the active job.',
          'Mesh generation has no displacement solution. FEM has no neural training losses. A comparison contains both FEM and PINN measurements.',
          'Browser references show Recorded CPU run and Stored training history. These are measurements from the saved run, not live training activity.',
        ],
      },
      {
        title: 'Current, stale or cancelled',
        bullets: [
          'Editing physical inputs makes old results stale. Rerun before interpreting them as the current problem.',
          'Cancel stops the owned numerical worker. Closing the application also stops its worker; a late or cancelled result cannot become current.',
          'A cancelled or failed run does not erase an earlier retained result, but its input/run identity must still be checked.',
        ],
        note: {
          tone: 'info',
          text: 'Projects retain run identity, input fingerprint, mesh identity, actual method/device and measurements. Saved PINN history is evidence of that run, not a resumable training checkpoint.',
        },
      },
    ],
    related: ['pinn', 'files', 'errors'],
  },
  {
    id: 'files',
    title: 'Save, reopen and export',
    summary: 'Keep project definitions and physical fields with explicit units and run identity.',
    category: 'Inspect',
    kind: 'Guide',
    keywords: [
      'save',
      'open',
      'file',
      'project',
      'phyra',
      'CSV',
      'export',
      'migration',
      'version',
      'checkpoint',
    ],
    sections: [
      {
        title: 'Project files',
        paragraphs: [
          'Save or Save as creates a .phyra archive with the project definition and available compatible cached fields. Reopening validates metadata and binary arrays before displaying results.',
          'Version 1 projects migrate to version 2 with an explicit notice. Legacy cached results are discarded; solve the migrated study again.',
        ],
      },
      {
        title: 'Export physical fields',
        paragraphs: [
          'Export writes authoritative SI CSV fields with node/cell associations, positions, displacement, reactions, stress and von Mises values. A comparison exports both FEM and PINN datasets.',
          'Coordinates/displacement use metres, force/reactions use newtons, and stress uses pascals regardless of the display unit or deformation amplification.',
        ],
        note: {
          tone: 'info',
          text: 'PINN settings, seed, history and evaluated fields persist. Model weights and optimizer state do not: reopening a project cannot resume training.',
        },
      },
    ],
    related: ['units', 'runs', 'results'],
  },
  {
    id: 'units',
    title: 'Units and signs at a glance',
    summary: 'Display conversion never changes the physical SI problem or exported fields.',
    category: 'Reference',
    kind: 'Reference',
    keywords: [
      'units',
      'SI',
      'mm',
      'metres',
      'millimetres',
      'Pa',
      'GPa',
      'N',
      'J',
      'sign',
      'stress',
    ],
    sections: [
      {
        title: 'Input and output units',
        facts: [
          {
            label: 'Length / prescribed displacement',
            value: 'Displayed in m or mm; stored/exported in m. 1 mm = 0.001 m.',
          },
          {
            label: 'Force / reaction',
            value:
              'N. Vector components follow global axes; supports report the reaction exerted on the model.',
          },
          {
            label: 'Pressure / stress',
            value:
              'Pa internally and in CSV. 1 MPa = 10⁶ Pa; material modulus is displayed in GPa.',
          },
          {
            label: 'Strain energy',
            value: 'J. Poisson’s ratio and training losses are dimensionless.',
          },
        ],
      },
      {
        title: 'Direction and component order',
        paragraphs: [
          'Positive vector components follow positive global X/Y/Z. Positive pressure points inward; it is not a fixed global vector.',
          'Stress component order is xx, yy, zz, xy, yz, xz. The shear stress components are tensor stresses, not doubled engineering shear strains.',
        ],
      },
    ],
    related: ['loads', 'supports', 'files'],
  },
  {
    id: 'errors',
    title: 'Resolve common problems',
    summary: 'Repair the physical input or supported configuration before repeating a run.',
    category: 'Reference',
    kind: 'Reference',
    keywords: [
      'error',
      'failed',
      'invalid',
      'under constrained',
      'conflict',
      'resource limit',
      'unavailable',
      'nonfinite',
      'stale',
    ],
    sections: [
      {
        title: 'Input and boundary errors',
        facts: [
          {
            label: 'Under-constrained / rigid body motion',
            value:
              'Add physically justified support components to remove free translation and rotation. Do not fix arbitrary components merely to make a solve pass.',
          },
          {
            label: 'Conflicting support',
            value:
              'Inspect shared boundary nodes and overlapping assignments. Prescribed values on the same component must agree.',
          },
          {
            label: 'Invalid assignment or region',
            value:
              'Choose an existing boundary and check conditions after changing geometry or dimension.',
          },
          {
            label: 'Invalid numeric input',
            value:
              'Complete or revert the draft value. Use finite values and the displayed units; dimensions, thickness and modulus must be positive.',
          },
        ],
      },
      {
        title: 'Mesh and execution errors',
        facts: [
          {
            label: 'Resource limit',
            value:
              'Use a larger mesh size or smaller supported problem. Mesh, metadata and field buffers are bounded.',
          },
          {
            label: 'Degenerate mesh / solve warning',
            value:
              'Review geometry proportions and mesh quality. Retry an appropriate mesh; an unexplained numerical warning is not a valid result.',
          },
          {
            label: 'Nonfinite training',
            value:
              'Review material/load scales and learning rate; start with the bounded plane-stress example and CPU. Compare any successful retry with FEM.',
          },
          {
            label: 'Unavailable device',
            value: 'Read the device reason, refresh the inventory, then select Auto or CPU.',
          },
          {
            label: 'Stale solution',
            value:
              'Rerun the current input. Old fields cannot validate changed geometry, conditions or method settings.',
          },
        ],
      },
    ],
    related: ['supports', 'mesh', 'devices'],
  },
  {
    id: 'scope',
    title: 'Supported physics and future work',
    summary:
      'Use the capabilities in this release; distinguish planned work from available methods.',
    category: 'Reference',
    kind: 'Reference',
    keywords: [
      'scope',
      'limits',
      'roadmap',
      'thermal',
      'fluid',
      'CAD',
      'nonlinear',
      'contact',
      'AI',
      'chat',
      'BYOK',
      'supported',
    ],
    sections: [
      {
        title: 'Available now',
        bullets: [
          'Homogeneous isotropic small-strain linear static elasticity: supported 3D primitives with FEM; rectangular 2D plane stress with FEM and experimental PINN.',
          'Global component displacement supports, distributed total force and inward/outward pressure on supported boundaries.',
          'Local offline execution, same-location comparison, physical fields, safe project persistence, CSV export and owned-worker cancellation.',
        ],
      },
      {
        title: 'Planned; not available in this release',
        bullets: [
          'General CAD/sketching, assemblies, multiple materials and broader geometry/condition preparation.',
          'Thermal/fluid, plane strain, dynamics, nonlinear materials, contact and coupled physics.',
          'Reusable learned operators, inverse studies, validated uncertainty and resumable model checkpoints.',
          'Optional BYOK chat and controlled engineering-assistant workflows. This help panel is offline documentation, not AI.',
        ],
        note: {
          tone: 'info',
          text: 'Future methods require independent numerical references, physical balance, failure tests and actual packaged workflows. A roadmap entry is not a supported solver.',
        },
      },
    ],
    related: ['study', 'fem-3d', 'pinn'],
  },
];

const contextArticles: Record<HelpContext, HelpArticleId> = {
  overview: 'first-study',
  geometry: 'geometry',
  material: 'material',
  conditions: 'supports',
  constraints: 'supports',
  loads: 'loads',
  mesh: 'mesh',
  study: 'study',
  solver: 'solver',
  results: 'results',
  runs: 'runs',
  files: 'files',
};

export function getHelpArticle(id: HelpArticleId): HelpArticle {
  return helpArticles.find((article) => article.id === id)!;
}

export function getContextArticle(context: HelpContext = 'overview'): HelpArticle {
  return getHelpArticle(contextArticles[context]);
}
