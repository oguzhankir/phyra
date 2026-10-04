export type HelpContext =
  | 'overview'
  | 'geometry'
  | 'selections'
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
  | 'preparation-tools'
  | 'geometry'
  | 'material'
  | 'study'
  | 'supports'
  | 'loads'
  | 'mesh'
  | 'solver'
  | 'fem-3d'
  | 'fem-2d'
  | 'kirsch-quarter'
  | 'pinn'
  | 'energy-pinn'
  | 'devices'
  | 'comparison'
  | 'results'
  | 'runs'
  | 'files'
  | 'units'
  | 'errors'
  | 'scope'
  | 'learning-path'
  | 'assistant'
  | 'local-mcp'
  | 'about'
  | 'scientific-references';

export interface HelpSection {
  title: string;
  paragraphs?: readonly string[];
  steps?: readonly string[];
  bullets?: readonly string[];
  facts?: readonly { label: string; value: string }[];
  note?: { tone: 'info' | 'warning'; text: string };
  references?: readonly {
    title: string;
    authors: string;
    year?: number;
    url: string;
    scope: string;
  }[];
  screenshots?: readonly { src: string; alt: string; caption: string }[];
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
    id: 'preparation-tools',
    title: 'Selection, boundary sets and edit history',
    summary: 'Select boundaries, preserve reusable sets, and safely undo model edits.',
    category: 'Prepare',
    kind: 'Guide',
    keywords: [
      'named selection',
      'boundary set',
      'undo',
      'redo',
      'camera',
      'isolate',
      'measurement',
      'repair',
    ],
    sections: [
      {
        title: 'Select and inspect',
        paragraphs: [
          'In 3D, selection addresses supported boundary faces; in 2D, it addresses boundary edges. Click replaces the selection, Shift adds, and Control/Command toggles. The selection-mode menu offers the same choices. Hover identifies a boundary before committing it.',
          'Use explicit Zoom in/out, standard camera directions, Fit model and Fit selection to inspect the model. F fits the model; Shift+F fits the selection. Middle-drag or Shift+drag pans. Right-click a boundary to create a support/load or boundary set from its selection. Isolate preserves a visible snapshot of the chosen boundaries; Restore all returns the full domain. Isolation changes presentation only, never the mesh, physics or solved domain.',
        ],
      },
      {
        title: 'Save and copy boundary sets',
        steps: [
          'Select the intended boundaries and choose Save boundary set.',
          'Give the set a unique nonempty name. The model tree and editor show its boundary IDs and geometry context.',
          'In a support or load editor, choose Copy a named selection. Review the copied boundaries before running.',
          'If the primitive type or study dimension changes, repair incompatible sets explicitly using the current viewport selection.',
        ],
        note: {
          tone: 'info',
          text: 'These are reusable copied boundary groups. Changing or deleting a set does not update previously assigned supports or loads. General CAD topology mapping and associative selections are future work.',
        },
        screenshots: [
          {
            src: '/help/preparation-workbench.jpg',
            alt: 'Phyra v0.3.0 preparation workspace with copied boundary sets and model view tools.',
            caption:
              'Current preparation workspace with copied boundary groups and a recorded CPU cantilever field. Measurement uses undeformed SI node or preview-vertex coordinates; it is not a CAD sketch dimension.',
          },
        ],
      },
      {
        title: 'Undo and redo',
        paragraphs: [
          'Use Edit → Undo/Redo, Command/Control Z, Shift Command/Control Z, or Control Y on Windows. Text fields keep their own native editing shortcuts; finish or revert incomplete numeric drafts before using model history.',
          'History stores project definitions in this session, with up to 80 edits and a 16 MiB budget. New/open/recover/reference actions start a new history. File destinations, scientific result buffers and trained weights are not history payloads.',
          'Physical undo/redo makes previous fields stale and requires a new analysis. Project-name, display-unit and boundary-set metadata edits preserve current results. Material/support/load edits retain conservative result invalidation.',
        ],
        note: {
          tone: 'warning',
          text: 'History is temporary and is not persisted across restart. Save a project explicitly; definition-only recovery provides separate protection. Changing primitive or study dimension clears incompatible assignments, with an explicit notice; Undo restores the prior definition.',
        },
      },
      {
        title: 'Geometry measurement',
        paragraphs: [
          'Viewport measurement reports node/vertex-to-node distance using the original undeformed coordinates in SI, converted only for display. In a meshed result, the available points are mesh nodes; in a primitive preview, they are tessellation vertices. It is not a CAD feature dimension or a distance measured on amplified deformation.',
        ],
      },
    ],
    related: ['geometry', 'supports', 'loads', 'files', 'results'],
  },
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
          'On Home, choose an editable example, or use New project to enter a name and choose 3D solid or 2D plane stress. File → New project and Ctrl/⌘ N open the same dialog.',
          'Use Save project to choose a .phyra file location. In the desktop app, Auto-save then keeps that file up to date after a short editing pause. Pending and failed writes remain visible; a successful write briefly shows confirmation. The Save button tooltip identifies the associated file.',
          'In Prepare, review the seven-item definition checklist. Open a check to inspect Study definition, Geometry, Material, Supports, Loads, Mesh or Method. Review actions lead to an editor; they do not certify that the preceding task is complete.',
          'In Supports and Loads, select named boundaries and define their physical conditions. Check visible units before entering values.',
          'Open Solve, choose a mesh size and use Generate mesh above the viewport. Inspect the element count and minimum quality.',
          'Open Solution method and use Run FEM. The main action above the viewport follows the selected task.',
          'In Inspect, choose a field from the viewport toolbar and review physical values and reference errors. Open details for equilibrium, assumptions and provenance; use Export fields for SI CSV data.',
          'Use Save to retain the study and compatible current results. A filled dot on the project tab marks unsaved edits; watch for pending or failed automatic writes. Find… or Ctrl/⌘ K searches existing editors and actions; F1 opens the current screen’s help.',
        ],
        screenshots: [
          {
            src: '/help/solid-workbench.jpg',
            alt: 'Phyra v0.3.0 workbench displaying a saved CPU cantilever FEM solution.',
            caption:
              'Current workspace with a recorded CPU FEM reference and independent project tabs. Deformation is amplified; computing new fields requires the desktop app.',
          },
        ],
      },
      {
        title: 'Try Physics ML next',
        paragraphs: [
          'On Home, choose Plate in tension, run its FEM reference, then select PINN or Compare FEM / PINN. Comparison evaluates both methods at shared physical locations.',
        ],
        note: {
          tone: 'warning',
          text: 'PINN is experimental. A completed training run or low loss does not establish engineering accuracy.',
        },
      },
      {
        title: 'Inspect a saved reference in the browser',
        paragraphs: [
          'On Home, use 3D FEM or 2D FEM / PINN under Explore recorded CPU results. Select result sources and fields, then probe values in the viewport.',
          'Both references contain saved fields and run provenance; the 2D comparison also contains recorded training history. Loading one starts no numerical worker. Editing physical inputs makes its fields stale; use the desktop application to mesh, solve, train and use native project files.',
        ],
      },
      {
        title: 'Read the workspace',
        paragraphs: [
          'The Home tab contains New, Open and examples. Each open project has its own tab, file association, edits and retained result. Selecting Home or another tab keeps projects open; return through a project tab or the Open in this session list. Up to 32 documents can be open.',
          'Use a project tab’s ×, File → Close project or Ctrl/⌘ W to close the active project. Unsaved changes offer Save, Discard and Cancel. Run and result ownership remain tied to the document that started the work.',
          'Prepare, Solve and Inspect sit above the viewport. The left model tree and Properties share one dock: selecting an object highlights its row and shows its name and settings directly below. The central viewport displays the model, fields or active 2D sketch. Right-click a boundary or object, or use its actions button, to find available operations.',
          'Problems keeps actionable diagnostics visible without opening every interpretation warning. Run overview retains execution evidence; training and comparison views appear only for supported studies. Advanced settings and scientific details remain available in disclosures.',
          'Light and dark themes change presentation, not physical values, units or the contour mapping.',
          'Ctrl/⌘ J opens the assistant. F1 opens offline help for the current task; the assistant uses the same versioned help articles.',
        ],
        screenshots: [
          {
            src: '/help/dark-workbench.jpg',
            alt: 'Phyra v0.3.0 dark workbench displaying saved CPU plane-stress displacement fields.',
            caption:
              'Current dark workspace with a saved CPU comparison and shared field controls. No training is running in this browser view.',
          },
        ],
      },
      {
        title: 'Check preparation before running',
        paragraphs: [
          'The preparation checklist covers study, geometry, material, supports, loads, mesh settings and solution method. Open an item to inspect its definition. A well-formed definition can be saved before its analysis is ready.',
          'The support check tests whether selected boundary components remove rigid translation and rotation in the current geometry. After meshing, the numerical worker applies its own rank check using singular values of the restrained rigid modes. Neither preparation status nor equilibrium alone establishes physical accuracy.',
        ],
      },
    ],
    related: ['study', 'supports', 'results', 'learning-path', 'assistant'],
  },
  {
    id: 'geometry',
    title: 'Define geometry and select boundaries',
    summary: 'Edit supported primitives and assign conditions to named geometric boundaries.',
    category: 'Prepare',
    kind: 'Guide',
    keywords: [
      'box',
      'cylinder',
      'bracket',
      'rectangle',
      'profile',
      'arc',
      'circle',
      'hole',
      'face',
      'edge',
      'selection',
      'dimension',
    ],
    sections: [
      {
        title: 'Supported domains',
        bullets: [
          '3D: a box, an X-axis cylinder, or a connected L bracket. Bracket thickness must be smaller than both in-plane dimensions.',
          '2D: a rectangle or one closed counterclockwise profile of 2–64 straight edges/circular arcs and up to 16 enclosed circular holes in X–Y. Each arc is at most 180°. Physical thickness belongs to the study.',
          'A cylinder spans X = 0 to length, with its axis centered at Y = Z = 0.',
        ],
      },
      {
        title: 'Draft a 2D profile',
        paragraphs: [
          'In 2D Geometry, the sketch canvas supports bounded rectangle, polyline and exact rounded-slot construction, grid snapping, circular holes and midpoint splitting of a straight boundary. Select an edge to convert between a line and a circular arc, edit its radius/center/direction, or move shared vertices. Work in the displayed length unit and inspect the line/arc definitions before applying them.',
          'Apply sketch validates and replaces the project geometry; Revert discards the draft. Leaving Geometry also discards unapplied changes. Drafting does not remesh or solve. Closed-loop orientation, intersections, arc limits and hole containment must pass validation. This editor does not provide a general geometric constraint solver, feature history or imported CAD.',
        ],
      },
      {
        title: 'Assign the intended boundary',
        steps: [
          'Select a face in 3D or an edge in 2D, then inspect its boundary name. Use the boundary list if a face is hard to reach.',
          'Create or edit a support/load and check its assigned boundaries. One assignment may include several boundaries.',
          'Profile IDs persist through remeshing. Editing or deleting an ID leaves its old assignment invalid: explicitly select a valid boundary and remove the missing assignment. Changing study dimension clears incompatible conditions.',
        ],
        note: {
          tone: 'info',
          text: 'Boundary identifiers describe geometry and persist through remeshing. New input values make the previous solution stale.',
        },
      },
    ],
    related: ['supports', 'loads', 'units', 'kirsch-quarter'],
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
              'In-plane displacement in a rectangle or line/arc profile with explicit physical thickness. FEM supports both; experimental strong-form PINN supports rectangular force/pressure studies and potential-energy PINN supports profiles with supported straight-edge displacement conditions.',
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
      {
        title: 'Typed spatial vector traction · FEM',
        paragraphs: [
          'Traction is t = σ(X,Y)n in Pa at boundary integration points, with the outward material normal. The supported stress fields are affine symmetric stress and Kirsch circular-hole stress. These are typed numeric definitions; arbitrary expression syntax is not accepted.',
          'For affine stress, each xx/yy/xy component is a + bX + cY. The constant a uses Pa, and the X/Y coefficients b/c use Pa/m. Coordinates remain SI metres when display units change. Integrated force uses the physical study thickness.',
          'For Kirsch stress, edit the center, radius and remote X tension. The intended reference is outside the stated circle; matching the exact quarter geometry and symmetry/outer conditions enables independent analytical diagnostics. A different boundary assignment or geometry may make the reference inapplicable.',
        ],
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
          'For profiles, enable Boundary refinement and choose a smaller boundary element size when curved features need additional resolution. Gmsh receives exact curves; first-order cells and boundary edges use chord approximations.',
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
    related: ['fem-3d', 'fem-2d', 'errors', 'scientific-references'],
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
          'For 2D plane stress, choose the Physics ML formulation in Solution method: Strong-form residual for rectangles, or Potential energy for rectangles/profiles. Review its stated boundary eligibility, network, quadrature/sampling, step and device settings.',
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
    keywords: [
      'FEM',
      '3D',
      'classical',
      'equations',
      'tetra4',
      'solid',
      'stress',
      'strain',
      'CPU',
      'Lamé',
      'Dirichlet',
      'Neumann',
      'weak form',
    ],
    sections: [
      {
        title: 'Physical and numerical model',
        paragraphs: [
          String.raw`For displacement $\mathbf u$ in the solid domain $\Omega$, the implemented small-strain equilibrium and homogeneous isotropic law are

$$
\nabla\!\cdot\boldsymbol\sigma=\mathbf0,\qquad
\boldsymbol\varepsilon(\mathbf u)=\tfrac12(\nabla\mathbf u+\nabla\mathbf u^{T}),\qquad
\boldsymbol\sigma=\lambda\,\operatorname{tr}(\boldsymbol\varepsilon)\mathbf I+2\mu\boldsymbol\varepsilon.
$$

$$
\mu=\frac{E}{2(1+\nu)},\qquad
\lambda=\frac{E\nu}{(1+\nu)(1-2\nu)}.
$$

$E$ is Young’s modulus in Pa and $\nu$ is Poisson’s ratio. Displacement uses m; strain is dimensionless; stress uses Pa. Volume body force is zero in this implementation; no body-load editor is exposed.`,
          'First-order tetrahedra interpolate nodal displacement linearly. Stress is constant within each element and transported without smoothing. A local CPU sparse solve computes displacement; reactions are recovered at prescribed components.',
          String.raw`The strain vector is $[\varepsilon_{xx},\varepsilon_{yy},\varepsilon_{zz},2\varepsilon_{xy},2\varepsilon_{yz},2\varepsilon_{xz}]^T$. The corresponding stress vector is $[\sigma_{xx},\sigma_{yy},\sigma_{zz},\sigma_{xy},\sigma_{yz},\sigma_{xz}]^T$: strain uses engineering shear, stress uses tensor shear.`,
        ],
        references: [
          {
            title: 'The step-8 elasticity tutorial',
            authors: 'deal.II contributors',
            url: 'https://dealii.org/current/doxygen/deal.II/step_8.html',
            scope:
              'Mathematical background for symmetric strain, isotropic elasticity and the weak form. Phyra uses its own tetrahedral implementation, not deal.II.',
          },
        ],
      },
      {
        title: 'Boundary conditions and weak form',
        paragraphs: [
          String.raw`On a prescribed component $i$, $u_i=\bar u_i$ on $\Gamma_{D,i}$ (Dirichlet). On its free boundary portion, $(\boldsymbol\sigma\mathbf n)_i=\bar t_i$ (Neumann), with outward unit normal $\mathbf n$. Conditions can differ by component on the same face. A boundary component with no applied load is traction-free. Positive pressure gives $\bar{\mathbf t}=-p\mathbf n$. A total force is distributed across the selected physical area.`,
          String.raw`For admissible test displacement $\mathbf v$ that vanishes on prescribed components, FEM solves

$$
\int_\Omega\boldsymbol\varepsilon(\mathbf v):\boldsymbol\sigma(\mathbf u)\,dV
=\int_{\Gamma_N}\mathbf v\cdot\bar{\mathbf t}\,dA.
$$

Element assembly gives $\mathbf K_e=V_e\mathbf B_e^T\mathbf D\mathbf B_e$. Prescribed degrees of freedom are eliminated:

$$
\mathbf K_{ff}\mathbf u_f=\mathbf f_f-\mathbf K_{fc}\bar{\mathbf u}_c,\qquad
\mathbf r_c=(\mathbf K\mathbf u-\mathbf f)_c.
$$

$\mathbf r_c$ are reactions at prescribed components. The worker rejects insufficient rigid-body restraints and unexplained sparse-solve warnings; it adds no hidden constraints.`,
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
          'The domain lies in X–Y. The model assumes σzz = τyz = τxz = 0 and solves Ux/Uy. Out-of-plane strain may still occur; plane stress is not plane strain.',
          String.raw`The implemented plane-stress constitutive matrix uses engineering shear $\gamma_{xy}=\partial_yu_x+\partial_xu_y=2\varepsilon_{xy}$:

$$
\begin{bmatrix}\sigma_{xx}\\\sigma_{yy}\\\sigma_{xy}\end{bmatrix}
=\frac{E}{1-\nu^2}
\begin{bmatrix}1&\nu&0\\\nu&1&0\\0&0&(1-\nu)/2\end{bmatrix}
\begin{bmatrix}\partial_xu_x\\\partial_yu_y\\\gamma_{xy}\end{bmatrix}.
$$

The shear stress $\sigma_{xy}$ is a tensor component; it is not doubled. For the constitutive reduction, $\varepsilon_{zz}=-\nu(\sigma_{xx}+\sigma_{yy})/E$ even though transported out-of-plane stress is zero.`,
          'First-order triangles assembled through scikit-fem provide the FEM discretization. Thickness scales stiffness, edge-load area and strain energy. It is an explicit physical input, not a display setting.',
          String.raw`For constant physical thickness $h$ and the in-plane domain $\Omega_2$, the weak form is

$$
h\int_{\Omega_2}\boldsymbol\varepsilon(\mathbf v):\boldsymbol\sigma(\mathbf u)\,dA
=h\int_{\Gamma_N}\mathbf v\cdot\bar{\mathbf t}\,ds.
$$

The tensor contraction counts both symmetric shear entries. With the engineering-strain vector, the same integrand is $\boldsymbol\varepsilon_{\mathrm{eng}}(\mathbf v)^T\mathbf D_{\mathrm{ps}}\boldsymbol\varepsilon_{\mathrm{eng}}(\mathbf u)$. There is no volume body-force term.`,
        ],
        references: [
          {
            title: 'scikit-fem API documentation',
            authors: 'scikit-fem contributors',
            url: 'https://scikit-fem.readthedocs.io/en/latest/api.html',
            scope:
              'Basis, vector elements, bilinear forms and facet quadrature used by the plane-stress adapter. The explicit matrix and thickness conventions above describe Phyra’s implementation.',
          },
        ],
      },
      {
        title: 'Set up and inspect',
        steps: [
          'Choose 2D plane stress and enter positive thickness.',
          'Define X/Y support components and in-plane total force, pressure or typed spatial traction on named edges.',
          'Run FEM and inspect in-plane displacement, cell stress and reactions. Export uses common three-component displacement/six-component stress layouts with unused out-of-plane fields zero.',
        ],
      },
    ],
    related: ['study', 'loads', 'comparison', 'kirsch-quarter'],
  },
  {
    id: 'kirsch-quarter',
    title: 'Circular cutout · independent Kirsch check',
    summary: 'Edit and solve a quarter plate through the ordinary profile and FEM workflow.',
    category: 'Solve',
    kind: 'Guide',
    keywords: [
      'Kirsch',
      'hole',
      'profile',
      'arc',
      'analytical',
      'reference',
      'convergence',
      'Le-Duc',
      'quarter',
    ],
    sections: [
      {
        title: 'Source and SI realization',
        paragraphs: [
          'Kirsch quarter plate · SI realization follows the circular-hole plane-stress example in Section 6.3 and Appendix B.2 of Le-Duc, Nguyen-Xuan and Lee (2026). The linked author implementation uses the second quadrant, X = −L to 0 and Y = 0 to L; the appendix gives the mirrored first quadrant.',
          'The sources give R = 1, L = 4, E = 100000, ν = 0.3 and remote X tension = 0.5, but state neither units nor physical thickness. Phyra authors an SI realization with these numerical values in m/Pa and a chosen 0.1 m thickness. This is Phyra FEM checked against an analytical solution; it does not reproduce nEPINN training or its performance.',
        ],
        references: [
          {
            title:
              'Normalized energy-based physics-informed neural network: Theory and applications to solid mechanics problems',
            authors: 'Thang Le-Duc, H. Nguyen-Xuan and Jaehong Lee',
            year: 2026,
            url: 'https://doi.org/10.1016/j.finel.2026.104523',
            scope:
              'Section 6.3 and Appendix B.2 establish the circular-hole problem and reference. Units and physical thickness are unstated.',
          },
          {
            title: 'Author circular-hole implementation · pinned 0889268',
            authors: 'Thang Le-Duc',
            url: 'https://github.com/ThangLe-duc/nEPINN/blob/0889268fbb3cb5cbbf92b4b9c7cf2c90f79fad75/Elasticity_2Dand3D/PlateWithHole.py',
            scope:
              'Second-quadrant coordinates, symmetry conditions and exact spatial outer traction; inspected for conventions, not copied or executed.',
          },
        ],
      },
      {
        title: 'Analytical stress and reference assumptions',
        paragraphs: [
          String.raw`The independent Kirsch field describes an infinite homogeneous isotropic plane-stress plate with a traction-free circular cavity of radius $a$, under remote X tension $T$. Set $r=\|\mathbf x-\mathbf c\|$, polar angle $\theta$ measured from +X, and $q=a^2/r^2$:

$$
\begin{aligned}
\sigma_{rr}&=\tfrac T2\left[(1-q)+(1-4q+3q^2)\cos2\theta\right],\\
\sigma_{\theta\theta}&=\tfrac T2\left[(1+q)-(1+3q^2)\cos2\theta\right],\\
\sigma_{r\theta}&=-\tfrac T2(1+2q-3q^2)\sin2\theta.
\end{aligned}
$$

At $r=a$, radial and shear traction vanish. The classical maximum hoop stress is $3T$ for remote uniaxial tension; a coarse FEM contour need not attain that analytical limit.`,
          'Phyra restricts this field to the finite second-quadrant domain using exact σn on its outer edges and component symmetry supports. This is not a finite plate loaded with uniform edge tension. The physical analytical reference is outside the cavity; its evaluator is undefined at the cavity center. Reference eligibility requires matching geometry and conditions.',
        ],
      },
      {
        title: 'Edit, solve and inspect',
        steps: [
          'On Home, choose Plate with a hole for the Kirsch quarter example. Inspect the clockwise circular cutout arc in the counterclockwise outer loop. Bottom uy = 0 and vertical ux = 0 are symmetry conditions; the cutout is free.',
          'Inspect Loads: the outer left and top edges use the exact spatial vector traction σn, not uniform tension on both edges. Review the stated center, radius and remote tension.',
          'Generate a mesh, then run FEM. Inspect displacement/stress, reactions, force/moment balance and Independent Kirsch reference in Results.',
          'Reduce target and boundary sizes and repeat. Compare area-weighted displacement/stress errors across at least three meshes. Free-hole traction from first-order element stress also needs refinement.',
          'For a changed case, use Arc radius in Geometry and separately update Hole radius and Remote X tension in Loads. Preserve matching geometry, symmetry and outer conditions for the independent reference. Save, reopen and export the resulting study.',
        ],
      },
      {
        title: 'What the diagnostics mean',
        paragraphs: [
          'Displacement and stress are evaluated at identical seven-point triangle quadrature locations. Relative L2 errors integrate area; stress uses the tensor Frobenius norm. Maximum errors use m/Pa, while relative metrics are dimensionless. A zero analytical norm gives an undefined relative error rather than 0/0.',
          'Free-hole traction RMS uses the finite-element boundary chord normals and is normalized by the absolute remote tension when nonzero. Linear triangular cells approximate the circle with chords; the model curves themselves remain exact.',
          'Reference diagnostics appear only for the supported matching quarter geometry and boundary conditions. An arbitrary edited profile still runs ordinary FEM when valid, without claiming an analytical reference. A single mesh or low error does not establish general accuracy.',
        ],
      },
    ],
    related: ['geometry', 'loads', 'mesh', 'fem-2d', 'results', 'files'],
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
        title: 'Physical normalization and autograd residual',
        paragraphs: [
          String.raw`For the rectangular domain, let $L$ be its largest in-plane span, $E$ the modulus and $u_D$ the largest absolute prescribed component. The current scales are

$$
S=\max\left(\max_{\partial\Omega}\|\bar{\mathbf t}\|,\frac{E u_D}{L},E\,10^{-8}\right),\qquad
U=\frac{SL}{E},\qquad
\hat{\mathbf x}=\frac{\mathbf x-\mathbf x_{\min}}L,\qquad
\hat{\mathbf u}=\frac{\mathbf u}U.
$$

$S$ has units Pa and $U$ has units m. With derivatives taken in $\hat{\mathbf x}$, the normalized engineering strain is $[\partial_{\hat x}\hat u_x,\partial_{\hat y}\hat u_y,\partial_{\hat y}\hat u_x+\partial_{\hat x}\hat u_y]^T$ and $\hat{\boldsymbol\sigma}=(\mathbf D_{\mathrm{ps}}/E)\hat{\boldsymbol\varepsilon}_{\mathrm{eng}}$. PyTorch autograd evaluates first displacement derivatives and second derivatives through stress.`,
          'The boundary traction term uses both endpoints and five interior Gauss points on every mesh boundary edge, evaluating the sum of physical loads. The endpoint maximum is exact for affine traction and constant force/pressure on each straight edge. For the nonlinear Kirsch field it is a representative sampled maximum, not a global bound. Total force is distributed over its entire assigned boundary area.',
          String.raw`The strong-form equilibrium residual is

$$
\hat{\mathbf r}=\begin{bmatrix}
\partial_{\hat x}\hat\sigma_{xx}+\partial_{\hat y}\hat\sigma_{xy}\\
\partial_{\hat x}\hat\sigma_{xy}+\partial_{\hat y}\hat\sigma_{yy}
\end{bmatrix}.
$$

The tanh network receives each coordinate mapped to $[-1,1]$. Its displacement construction combines compatible constant/linear prescribed-displacement lifting with products of edge-distance factors. These factors vanish on the prescribed edges, enforcing supported constant component values exactly.`,
        ],
        references: [
          {
            title:
              'Physics-informed neural networks: a deep learning framework for forward and inverse PDE problems',
            authors: 'M. Raissi, P. Perdikaris and G. E. Karniadakis',
            year: 2019,
            url: 'https://doi.org/10.1016/j.jcp.2018.10.045',
            scope:
              'General strong-form residual method adapted to the narrower Phyra elasticity problem; not a reproduction of the paper experiments.',
          },
          {
            title: 'Automatic differentiation with torch.autograd',
            authors: 'PyTorch contributors',
            url: 'https://docs.pytorch.org/tutorials/beginner/basics/autogradqs_tutorial.html',
            scope:
              'Framework derivatives used for displacement gradients and equilibrium residuals.',
          },
        ],
      },
      {
        title: 'Exact loss convention',
        paragraphs: [
          String.raw`For $N$ interior points and $M$ boundary points, let $C_{ji}$ be 1 when boundary component $i$ is prescribed, and $F_{ji}=1-C_{ji}$. Traction and prescribed displacement are scaled by $S$ and $U$:

$$
\begin{aligned}
\mathcal L_{\mathrm{PDE}}&=\frac1{2N}\sum_{j=1}^N\sum_{i=1}^2\hat r_{ji}^{\,2},\\
\mathcal L_t&=\frac{\sum_{j,i}F_{ji}\left[(\hat{\boldsymbol\sigma}_j\mathbf n_j)_i-\hat t_{ji}\right]^2}{\max(1,\sum_{j,i}F_{ji})},\\
\mathcal L_u&=\frac{\sum_{j,i}C_{ji}(\hat u_{ji}-\hat u_{D,ji})^2}{\max(1,\sum_{j,i}C_{ji})},\\
\mathcal L_{\mathrm{boundary}}&=\mathcal L_t+\mathcal L_u,\qquad
\mathcal L=\mathcal L_{\mathrm{PDE}}+\mathcal L_{\mathrm{boundary}}.
\end{aligned}
$$

All weights are 1. Traction is penalized only on free components; the displacement loss checks the prescribed components despite their exact lifting. Adam minimizes this dimensionless objective at the seeded training samples. FEM fields do not enter the loss.`,
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
          'Independent-point residuals evaluate the normalized PDE and boundary objectives after optimization at separately sampled points of the same physical problem. They diagnose residual behavior beyond the training samples; they are not field-error bounds or evidence of generalization to new problems. Older saved runs may not include them.',
        ],
        note: {
          tone: 'warning',
          text: 'The strong-form formulation is available only for rectangular force/pressure 2D plane stress. Potential energy extends training to profiles and typed traction, with restricted prescribed boundaries. It is a numerical learning method, not a chat assistant or a guarantee of faster solving.',
        },
      },
    ],
    related: ['energy-pinn', 'devices', 'comparison', 'learning-path', 'scientific-references'],
  },
  {
    id: 'energy-pinn',
    title: 'Physics ML · potential energy and partial supports',
    summary:
      'Train the same plane-stress definition using an integral objective and exact displacement conditions.',
    category: 'Solve',
    kind: 'Method',
    experimental: true,
    keywords: [
      'energy',
      'variational',
      'EPINN',
      'Wang',
      'partial support',
      'quadrature',
      'profile',
      'hole',
    ],
    sections: [
      {
        title: 'Reusable method and scope',
        paragraphs: [
          'Potential energy uses the ordinary rectangle/profile geometry, homogeneous isotropic material, physical thickness, component supports and total force/pressure/affine or Kirsch traction. A dense tanh displacement network uses first-order autograd strain; FEM fields are never training labels.',
          'Prescribed components can have compatible constant values on finite straight exterior segments. The displacement construction vanishes only on those segments, so a free collinear neighboring segment remains free. Curved prescribed edges, intersecting incompatible values and non-supporting interior lines are rejected explicitly. Natural traction conditions enter through external work.',
          'This is experimental small-strain elasticity, not a large-displacement, nonlinear, contact or reusable operator model.',
        ],
      },
      {
        title: 'Objective and independent integration audit',
        paragraphs: [
          String.raw`For physical thickness $h$, the admissible displacement minimizes

$$
\Pi(\mathbf u)=\frac h2\int_\Omega \boldsymbol\varepsilon_{\rm eng}^T\mathbf D_{\rm ps}\boldsymbol\varepsilon_{\rm eng}\,dA-h\int_{\Gamma_t}\bar{\mathbf t}\cdot\mathbf u\,ds.
$$

The reported normalized potential is strain energy minus external work. It may be negative and is plotted on a linear signed axis. Its physical scale is $SULh$ joules, with stress/displacement/length scales $S,U,L$ recorded by the method.`,
          'Training integrates over actual mesh triangles and boundary chords using deterministic composite quadrature. Point settings are minimum quadrature counts; actual counts are reported. A separate finer quadrature recomputes strain, work and potential after optimization. A relative discrepancy above 1% rejects publication. Its relative integration difference measures integration sensitivity of the trained field; it does not measure error against the physical solution.',
          'Live total/PDE/boundary curves remain nonnegative strong-form residual diagnostics, not the minimized energy objective. Read them with independent-point residuals, FEM field differences and force/moment balance. Mesh refinement, quadrature refinement, network/step changes and seed variation test distinct error sources.',
        ],
      },
      {
        title: 'Paper-informed eccentric-displacement case',
        paragraphs: [
          'Home → Eccentric displacement opens a square profile with a split top edge, a fixed bottom and prescribed displacement on only the left top half. It follows the boundary pattern in Wang et al. (2023), Section 3.2. The source used large-displacement reference analysis; Phyra solves an explicitly disclosed small-strain adaptation.',
          'The editable SI realization uses side 1 m, E = 10 MPa, ν = 0.2 and driven ux = 0, uy = 0.1 m. SI length/modulus conventions follow the same author’s 2024 follow-up; thickness 0.01 m is a Phyra choice. The original tensor-decomposed architecture, finite-difference derivatives and Modulus/GPU runtime are not reproduced.',
          'The driven displacement is 10% of the side. Treat this as a mathematical linear-model comparison; it does not validate physical large-deformation behavior. Reduce the displacement to study smaller-strain loading.',
        ],
        steps: [
          'Inspect Geometry in the central sketch. Draw a rectangle and split a selected straight edge at its midpoint to build a partial boundary in any valid profile. Apply and explicitly repair assignments after changing IDs.',
          'Inspect the bottom and driven-half support components, then Compare FEM / PINN from Solution method. Choose the same physical problem for both paths.',
          'Inspect signed energy/audit, independent residuals, field differences, actual CPU/device precision and balance. Corner mixed-boundary behavior and a short optimization run can leave substantial error.',
          'Change driven displacement, geometry or material; remesh and compare again. Save/reopen retains measured fields and history, not resumable neural weights.',
        ],
        references: [
          {
            title:
              'Exact Dirichlet Boundary Physics-informed Neural Network EPINN for Solid Mechanics',
            authors: 'Jiaji Wang, Y. L. Mo, Bassam Izzuddin and Chul-Woo Kim',
            year: 2023,
            url: 'https://doi.org/10.1016/j.cma.2023.116184',
            scope:
              'Energy/exact-boundary ideas and Section 3.2 boundary pattern; disclosed method and small-strain deviations.',
          },
          {
            title: 'Author manuscript · Section 3.2',
            authors: 'Jiaji Wang and coauthors',
            url: 'https://hub.hku.hk/bitstream/10722/331900/1/content.pdf',
            scope: 'Primary accessible paper source; no paper data or software is bundled.',
          },
          {
            title: 'Author follow-up · SI conventions',
            authors: 'Jiaji Wang and coauthors',
            year: 2024,
            url: 'https://doi.org/10.1111/mice.13292',
            scope:
              'Section 3.2 gives the 1 m / 10 MPa conventions; it does not establish Phyra accuracy.',
          },
        ],
      },
      {
        title: 'Other geometries through the same path',
        paragraphs: [
          'Energy · plate in tension provides an analytical axial patch baseline. Energy · circular cutout uses the existing Kirsch profile/traction contract. These are ordinary editable projects, not special solvers. The repository research-case manifest records provenance, deviations, reference policy and repeatable measurement commands.',
        ],
      },
    ],
    related: ['pinn', 'geometry', 'supports', 'loads', 'comparison', 'kirsch-quarter'],
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
        screenshots: [
          {
            src: '/help/comparison-workbench.jpg',
            alt: 'Phyra v0.3.0 plane-stress comparison showing shared FEM fields and recorded FEM/PINN difference metrics.',
            caption:
              'Saved CPU plane-stress comparison with FEM selected. Switch sources to inspect PINN and differences; these are recorded measurements.',
          },
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
          'When present, Independent-point residuals report normalized losses at separate post-training sample points. Not recorded means the saved run lacks this diagnostic; it does not mean zero residual.',
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
    title: 'Save, close, recover and export',
    summary:
      'Choose a project file, understand auto-save and recovery, and retain physical fields.',
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
      'recovery',
      'autosave',
      'close',
      'discard',
      'tab',
      'crash',
    ],
    sections: [
      {
        title: 'Project files',
        paragraphs: [
          'A new project or example is an unsaved draft until its first Save. Use Save project, File → Save or Ctrl/⌘ S to choose a .phyra file location. Save as chooses a different destination. Archives contain the project definition and available compatible cached fields; reopening validates metadata and binary arrays before displaying results.',
          'Versions 1–4 are validated against frozen schemas before migrating to version 5 with the strong-form formulation. Version 1 cached fields are discarded; older compatible fields pass normal ownership, input-fingerprint and scientific-field validation before reuse. Version 3 named boundary sets are preserved.',
          'Version 4 adds exact profiles and typed traction inputs. Their physical fingerprints are distinct from primitive studies. Older recovery journals migrate in memory without overwriting the original copy. Edit history is session-only and is not stored in an archive or recovery journal.',
        ],
      },
      {
        title: 'Auto-save to the project file',
        paragraphs: [
          'In the desktop app, Auto-save is on by default. After the first Save associates a file, validated changes are written to that file after a 1.5-second editing pause. Pending, saving, paused and failed states remain visible; successful saves briefly show confirmation. The Save button tooltip identifies the associated file.',
          'Turn Auto-save off in the project bar to save manually. Invalid numeric drafts pause automatic writes; complete or revert them before saving. Auto-save also waits while an analysis, file operation or project confirmation is active.',
          'If an automatic write fails, the project remains open with unsaved changes and a failure message. Use Save to retry. A browser preview cannot write native project files.',
        ],
      },
      {
        title: 'Home, tabs and closing',
        paragraphs: [
          'Home contains examples and project-start actions. Switching to Home or another project preserves each open document’s definition, edit history, file association and retained result. Up to 32 project tabs are supported. Changing tabs does not trigger a save; enabled Auto-save continues independently.',
          'Close the project with its tab’s ×, File → Close project or Ctrl/⌘ W. A saved project closes directly. A dirty project offers Save, Discard and Cancel: Save closes only after a successful write, Discard closes without retaining those changes, and Cancel keeps the project open.',
          'An automatic write already in progress finishes before closing is considered. New and Open create another document tab. Cancelling the first file-location dialog keeps the draft open. Each document owns its execution and result identity; a run started in another tab cannot publish into the active project.',
        ],
      },
      {
        title: 'Recover an unsaved project',
        paragraphs: [
          'Recovery is separate from Auto-save. The desktop keeps a recovery copy of a valid, dirty definition after a short editing pause, including drafts that have no project file yet. Recovery pauses while numeric drafts or the definition are invalid; save manually if recovery is unavailable.',
          'At a later launch, review available copies and choose Restore, Discard copy or Review later. Active desktop sessions remain separate. Restore opens an unsaved definition and clears its original file association; it does not overwrite that file.',
          'Recovery contains no result buffers, trained weights or optimizer state. Recompute the restored study, then use Save to choose its project file. Auto-save starts after that first Save. A recovery copy is not a substitute for a saved .phyra archive or backup.',
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
        screenshots: [
          {
            src: '/help/problems-workbench.jpg',
            alt: 'Phyra v0.3.0 Problems panel showing recorded cantilever result-interpretation warnings.',
            caption:
              "The Problems panel keeps the saved cantilever reference's bending-stiffness and unsmoothed-stress warnings visible alongside its physical fields.",
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
          {
            label: 'Recovery paused / unavailable',
            value:
              'Complete or revert invalid inputs. If recovery remains unavailable, save current work manually; prior unreadable copies are preserved for investigation.',
          },
        ],
      },
    ],
    related: ['supports', 'mesh', 'devices'],
  },
  {
    id: 'assistant',
    title: 'Ask the documentation and study assistant',
    summary: 'Connect your providers, choose a model, and ask about the active study.',
    category: 'Get started',
    kind: 'Guide',
    keywords: [
      'AI',
      'assistant',
      'chat',
      'BYOK',
      'Gemini',
      'OpenAI',
      'Anthropic',
      'Ollama',
      'API',
      'key',
      'provider',
      'model',
      'context',
      'citation',
      'Ctrl J',
    ],
    sections: [
      {
        title: 'Connect and select a model',
        steps: [
          'Open AI assistant with the assistant icon or Ctrl/⌘ J, then open Connections.',
          'Choose Gemini, OpenAI, Anthropic, an OpenAI-compatible HTTPS endpoint, or a user-managed Ollama/local loopback endpoint. Remote connections use your own provider key.',
          'Paste your key and Connect. The app checks the models reported by that account before saving the connection. Connect several providers independently; each connection keeps its own endpoint and model catalog. Connecting another provider does not replace the model selected in an existing chat.',
          'Choose a model in the composer from your connected providers. Write your question and Send. Sending authorizes that turn to use the selected provider with relevant offline help and the active study snapshot; there is no separate context attachment or repeated sharing dialog.',
        ],
        paragraphs: [
          'The implemented transport supports streaming text: Gemini streamGenerateContent, OpenAI Responses, Anthropic Messages, and OpenAI-compatible Chat Completions for compatible/Ollama endpoints. This assistant does not invoke model tools, browse the web, edit a definition, start numerical work or export fields. Model limits and usage are shown only when the provider supplies them; pricing and cost estimates are unknown.',
          'Local endpoints must use an explicit loopback address. Remote endpoints require HTTPS; named providers use their fixed official endpoints. Authentication is added by the native layer. Redirects are blocked. Keys are scoped by provider and endpoint origin, and the interface receives only credential-presence status.',
        ],
      },
      {
        title: 'What the context contains',
        paragraphs: [
          'Documentation context retrieves articles from this installed application’s offline help. Study context adds the exact SI definition, preparation status, available run/result summaries, measured diagnostics and project/study/revision identity. In Inspect, it can include the selected field range and a picked node/element value with its undeformed SI position and exact job/fingerprint. Changing fields or results clears the previous pick. No local file path, imported CAD file, screenshot, vertex array, full field buffer or trained weights is automatically attached.',
          'Sending also includes a bounded set of recent completed user/assistant turns from the selected conversation. Those messages may contain an earlier study explanation. Start a new conversation when prior content should be excluded. The native context limit is 128 KiB and the whole request is bounded; it is not the selected model’s token capacity.',
          'Each stored answer retains its provider, model, endpoint, exact supplied context and completion status, with usage when reported. Follow an article citation to its offline source. Study values should cite the study ID/revision; result values should cite their job/fingerprint.',
        ],
        note: {
          tone: 'warning',
          text: 'An answer describes the context supplied for that turn. Editing a study or changing tabs does not update earlier answers. A citation or a preparation check is not a physical guarantee; check current solver provenance, independent references and numerical diagnostics.',
        },
      },
      {
        title: 'Local history and cancellation',
        paragraphs: [
          'Conversation history is stored separately from .phyra archives in the application’s local assistant storage, in version 1 format. The bounds are 160 messages and 2 MiB per conversation, 100 conversations and 32 MiB total history. History may contain private study definitions and summaries included with your questions; it is not encrypted project backup.',
          'The app saves the question before contacting a provider. If this initial write fails, the question stays in the composer and no remote request starts. If the response cannot be saved, its text stays in the panel with Retry save. Repair credential authorization or local storage, then retry. Restore saved copy requires confirmation before discarding unsaved response changes; a failed restore keeps the text. A conversation opened in two document tabs shares its latest text. A response reaching the local history limit stops with its partial text marked cancelled.',
          'Provider connections persist across application restarts. Connections lists each saved provider separately. Disconnect removes that connection while preserving local conversations and projects. Its saved key is removed only when no other connection shares the same provider origin; other connected providers remain available. Removing a stored key does not revoke it at the provider. On macOS, changed ad hoc development builds can require renewed Keychain authorization; a stable signing identity is part of the packaged-product setup.',
          'Stop cancels the native provider stream and preserves the visible partial response with its cancellation status. A provider may already have processed submitted input; cancellation does not establish a billing refund. Delete a conversation through the history control when it is no longer wanted.',
          'Offline help and all numerical analysis remain available without a provider account or key. The browser preview exposes offline help; provider connections and native credential storage require the desktop app.',
        ],
      },
    ],
    related: ['local-mcp', 'scope', 'runs', 'scientific-references', 'about'],
  },
  {
    id: 'local-mcp',
    title: 'Connect local MCP tools',
    summary: 'Choose individual read-only tools and connect your desktop AI client.',
    category: 'Reference',
    kind: 'Guide',
    keywords: [
      'MCP',
      'stdio',
      'protocol',
      'permission',
      'scope',
      'audit',
      'lease',
      'client',
      'read only',
      '2025-11-25',
    ],
    sections: [
      {
        title: 'Choose tools and connect a client',
        steps: [
          'Open Integrations in the assistant header. In Tools, enable or disable Inspect capabilities, Search product help, Read study definition and Inspect analysis results independently.',
          'Choose Start MCP, then Connect client. Open in VS Code uses its official installation handler so you can review and install the server there. Copy configuration offers the VS Code servers format or the mcpServers format used by Claude and compatible desktop clients.',
          'Keep Phyra open and start the server in your client. Access log shows allowed and denied requests. Changing the enabled tools invalidates older clients; use the updated configuration and restart their Phyra server. Stop MCP revokes access.',
        ],
        paragraphs: [
          'The implemented server is pinned to MCP protocol 2025-11-25. It exposes versioned capability/help/project/run inspection and resources, with project/revision and run provenance where the enabled tools permit them. Access follows the active project tab; the client should inspect each returned identity before using a snapshot.',
          'Consent is native-enforced and refreshed by the active application session. Its lease expires after 90 seconds without refresh, and closing/releasing the session revokes it. Starting MCP authorizes that local client to read the enabled tool snapshots until revoked or expired; a client’s own provider may handle data under its separate configuration.',
          'The current MCP surface has no model mutations, geometry changes, mesh/run/export actions, arbitrary file reads, general shell or public network listener. Approved agent workflows and parameter sweeps remain future work. Read-only access does not establish that an external client’s interpretation is scientifically correct.',
        ],
        references: [
          {
            title: 'VS Code MCP installation and client configuration',
            authors: 'Microsoft',
            url: 'https://code.visualstudio.com/api/extension-guides/ai/mcp',
            scope: 'Official local stdio server configuration and vscode:mcp/install URI handler.',
          },
          {
            title: 'Local stdio client configuration',
            authors: 'Model Context Protocol contributors',
            url: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
            scope: 'Official Claude Desktop mcpServers configuration and server restart guidance.',
          },
        ],
      },
    ],
    related: ['assistant', 'scope', 'files', 'runs'],
  },
  {
    id: 'about',
    title: 'Source, license and product evidence',
    summary: 'Find the product source and distinguish implementation from verification evidence.',
    category: 'Reference',
    kind: 'Reference',
    keywords: [
      'about',
      'GitHub',
      'source',
      'GPL',
      'license',
      'copyright',
      'notice',
      'evidence',
      'screenshots',
    ],
    sections: [
      {
        title: 'Source and license',
        paragraphs: [
          'Phyra is distributed under GPL-3.0-or-later. The source repository contains LICENSE, canonical README/CONTRIBUTING/ROADMAP/SECURITY and citation metadata, plus required upstream notices in notices/THIRD_PARTY.txt. Target-specific redistribution and Corresponding Source obligations remain relevant to packaged binaries.',
          'Provider marks identify optional connections. The four bundled SVG marks are a subset of @lobehub/icons-static-svg 1.95.1, with its MIT license and provenance notice under public/providers. Names and marks belong to their respective owners; their appearance does not imply endorsement.',
        ],
        references: [
          {
            title: 'Phyra source repository',
            authors: 'Oğuzhan Kır and contributors',
            url: 'https://github.com/oguzhankir/phyra',
            scope:
              'Product source, license, canonical documentation, issue reporting and implementation evidence.',
          },
        ],
      },
      {
        title: 'Evidence and media',
        paragraphs: [
          'The help screenshots and promotional video show the v0.3.0 interface using genuine saved CPU references. Browser reference views do not run numerical workers, and the video labels future direction separately. Packaged checks, actual device tests and clean-machine installation are distinct evidence; a configured adapter or test fixture does not establish live provider or platform verification.',
        ],
      },
    ],
    related: ['scope', 'scientific-references', 'assistant'],
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
          'Homogeneous isotropic small-strain linear static elasticity: supported 3D primitives and bounded line/arc/circular-hole profiles with FEM; rectangular 2D plane stress with FEM and experimental PINN.',
          'Global component displacement supports, distributed total force and inward/outward pressure on supported boundaries; typed affine/Kirsch spatial traction for 2D FEM.',
          'Local offline execution, same-location comparison, physical fields, safe project persistence, CSV export and owned-worker cancellation.',
          'Bounded 2D profile drafting, a preparation checklist, independent project tabs, optional BYOK documentation/study chat and opt-in local read-only MCP snapshots.',
        ],
      },
      {
        title: 'Planned; not available in this release',
        bullets: [
          'General CAD/sketching, assemblies, multiple materials, orthotropic/anisotropic properties, composites, laminates and functionally graded materials.',
          'Thermal/fluid, plane strain, dynamics, nonlinear materials, contact and coupled physics.',
          'Reusable learned operators, inverse studies, validated uncertainty and resumable model checkpoints.',
          'Optional external Physics ML framework adapters and distributed/HPC execution. Current local device capability does not establish framework or distributed support.',
          'Assistant-driven model changes, solver actions, approved parameter sweeps and research agents. Current chat explains supplied documentation/study summaries; local MCP exposes read-only snapshots.',
        ],
        note: {
          tone: 'info',
          text: 'Future methods require independent numerical references, physical balance, failure tests and actual packaged workflows. A roadmap entry is not a supported solver.',
        },
      },
    ],
    related: ['study', 'fem-3d', 'pinn', 'assistant', 'local-mcp', 'scientific-references'],
  },
  {
    id: 'learning-path',
    title: 'Physics ML learning path',
    summary: 'Understand one real elasticity problem, then evaluate its PINN against a reference.',
    category: 'Get started',
    kind: 'Guide',
    keywords: ['learning', 'tutorial', 'physics ml', 'PINN', 'autograd', 'residual', 'validation'],
    sections: [
      {
        title: '1 · Define the problem before the network',
        paragraphs: [
          'On Home, choose Plate in tension. Read geometry, physical thickness, Young’s modulus, Poisson’s ratio, supports and total force. These define an in-plane, homogeneous, small-strain equilibrium problem; selecting a learning method does not change that problem.',
        ],
        steps: [
          'Run Classical FEM and inspect displacement, element stress, reactions and force/moment balance.',
          'Choose a quantity to check, such as end displacement. Refine the mesh and compare that quantity; a single mesh is not a convergence study.',
        ],
      },
      {
        title: '2 · Understand what training minimizes',
        paragraphs: [
          'The current PINN represents displacement with a smooth neural network. Automatic differentiation computes strain, material stress and equilibrium residuals at sampled interior points. Boundary terms evaluate the prescribed physical conditions.',
          'The displacement construction enforces supported prescribed components. Traction and remaining free-component conditions enter the boundary objective. Coordinates, displacement and stress scales normalize the problem; reported training losses are dimensionless, not field errors in metres or pascals.',
          'Both formulations train one physical problem without FEM labels; energy training uses an integral objective while strong-form training minimizes residuals. The FEM solution is used for comparison, not supplied as training data.',
        ],
      },
      {
        title: '3 · Judge the physical result',
        steps: [
          'Run Compare FEM / PINN. Inspect the live loss history and actual device/precision.',
          'Read Independent-point residuals when available. These test separate points within this problem, not new physical instances, and do not replace field-error or balance checks.',
          'Switch FEM and PINN sources for displacement and von Mises stress, then view absolute and relative differences at their shared nodes/cell centroids.',
          'Probe locations away from idealized corner singularities. Read reactions and force/moment balance for each method.',
          'Vary the seed or justified sampling/training settings to examine sensitivity. Compare physical fields and balance rather than selecting a run solely for its lowest training loss.',
          'Save the study and record its settings, seed, framework/device and measured fields. Reopening a result does not restore trained network weights.',
        ],
        screenshots: [
          {
            src: '/help/training-workbench.jpg',
            alt: 'Independent-point PDE and boundary residual measurements from a completed CPU plane-stress training reference.',
            caption:
              'Independent-point residual measurements in the stored training view of the saved CPU plane-stress reference. Residuals measure this trained problem and do not establish field-error bounds.',
          },
        ],
        note: {
          tone: 'warning',
          text: 'Low training loss and agreement with one FEM mesh do not certify accuracy. Independent references, unseen evaluation points, multiple seeds and refinement answer different questions.',
        },
      },
      {
        title: '4 · Recognize distinct method families',
        bullets: [
          'Potential-energy PINN minimizes integrated elastic energy minus external work with admissible displacement fields. Inspect its signed objective and independent finer-quadrature audit separately from strong-form residual diagnostics.',
          'FNO and DeepONet learn reusable mappings across a defined problem family. Their dataset and held-out physical instances differ from fitting one problem.',
          'Learned constitutive models approximate a material law inside an actual solver; they need load-path, tangent and physical-admissibility checks.',
          'External frameworks, GPU acceleration and distributed execution are separate runtime capabilities. None makes a numerical method automatically accurate or supported.',
        ],
      },
    ],
    related: ['pinn', 'comparison', 'devices', 'scientific-references'],
  },
  {
    id: 'scientific-references',
    title: 'Scientific method references',
    summary:
      'Primary sources for the current mesher and PINN, with future method tracks identified.',
    category: 'Reference',
    kind: 'Reference',
    keywords: [
      'paper',
      'citation',
      'references',
      'Gmsh',
      'Raissi',
      'Deep Ritz',
      'FNO',
      'DeepONet',
      'PhysicsNeMo',
    ],
    sections: [
      {
        title: 'Upstream meshing',
        references: [
          {
            title:
              'Gmsh: a three-dimensional finite element mesh generator with built-in pre- and post-processing facilities',
            authors: 'Christophe Geuzaine and Jean-François Remacle',
            year: 2009,
            url: 'https://doi.org/10.1002/nme.2579',
            scope:
              'Primary description of the upstream mesher. Phyra exposes a bounded primitive workflow; the paper does not establish broader geometry or solver support.',
          },
        ],
      },
      {
        title: 'Plane-stress FEM backend',
        references: [
          {
            title: 'scikit-fem API documentation',
            authors: 'scikit-fem contributors',
            url: 'https://scikit-fem.readthedocs.io/en/latest/api.html',
            scope:
              'Maintained finite-element assembly library used by the narrow first-order plane-stress adapter. Phyra independently checks constitutive factors, traction integration and analytical convergence.',
          },
        ],
      },
      {
        title: 'Implemented method',
        paragraphs: [
          'Phyra adapts residual-based neural approximation to rectangular plane-stress elasticity. The primary paper explains the general method; the current equations, boundary construction, independent tests and actual measured results define Phyra’s narrower implementation.',
        ],
        references: [
          {
            title:
              'Physics-informed neural networks: a deep learning framework for forward and inverse PDE problems',
            authors: 'M. Raissi, P. Perdikaris and G. E. Karniadakis',
            year: 2019,
            url: 'https://doi.org/10.1016/j.jcp.2018.10.045',
            scope:
              'Foundation for the implemented strong-form residual/autograd approach; Phyra does not reproduce all paper experiments.',
          },
          {
            title: 'Automatic differentiation with torch.autograd',
            authors: 'PyTorch contributors',
            url: 'https://docs.pytorch.org/tutorials/beginner/basics/autogradqs_tutorial.html',
            scope:
              'Framework documentation for the derivatives used by the current PINN. Operator/device support still requires actual tests.',
          },
        ],
      },
      {
        title: 'Future methods and runtime research',
        references: [
          {
            title: 'The Deep Ritz method',
            authors: 'Weinan E and Bing Yu',
            year: 2018,
            url: 'https://arxiv.org/abs/1710.00211',
            scope:
              'Variational neural approximation foundation. Phyra implements a restricted small-strain elasticity potential-energy adaptation, not all paper examples.',
          },
          {
            title: 'Fourier Neural Operator for Parametric Partial Differential Equations',
            authors: 'Z. Li and coauthors',
            year: 2021,
            url: 'https://arxiv.org/abs/2010.08895',
            scope:
              'Reusable operator research requiring training data and held-out problem-family validation; not implemented.',
          },
          {
            title: 'Learning nonlinear operators via DeepONet',
            authors: 'L. Lu, P. Jin, G. Pang, Z. Zhang and G. E. Karniadakis',
            year: 2021,
            url: 'https://doi.org/10.1038/s42256-021-00302-5',
            scope:
              'Branch/trunk operator-learning research; not implemented in the current per-problem PINN.',
          },
          {
            title: 'PhysicsNeMo framework installation and capabilities',
            authors: 'NVIDIA PhysicsNeMo contributors',
            url: 'https://docs.nvidia.com/physicsnemo/latest/getting-started/installation.html',
            scope:
              'Potential external execution/model adapter. No PhysicsNeMo integration or distributed execution is available in Phyra today.',
          },
        ],
        note: {
          tone: 'info',
          text: 'External source pages require a network connection. Help text and the current numerical workflow remain local; opening a reference does not send a project or start computation.',
        },
      },
    ],
    related: ['learning-path', 'pinn', 'scope'],
  },
];

const contextArticles: Record<HelpContext, HelpArticleId> = {
  overview: 'first-study',
  geometry: 'geometry',
  selections: 'preparation-tools',
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
