import { ArrowDownLeft, LockKeyhole } from 'lucide-react';
import { sectionTitles } from '../workbench/navigation';
import GeometryEditor from './GeometryEditor';
import NamedSelectionEditor from './NamedSelectionEditor';
import LoadEditor from './LoadEditor';
import MaterialEditor from './MaterialEditor';
import MeshEditor from './MeshEditor';
import ResultsInspector from './ResultsInspector';
import SolverEditor from './SolverEditor';
import StudyEditor from './StudyEditor';
import SupportEditor from './SupportEditor';

import type { ProjectInspectorModel } from './model';
export default function PropertyInspector({
  workbench,
  panelId = 'workbench-properties-panel',
}: {
  workbench: ProjectInspectorModel;
  panelId?: string;
}) {
  const { section, locked, project, busy } = workbench;
  const selectedName =
    section === 'study'
      ? project.name
      : section === 'material'
        ? project.study.material.name
        : section === 'constraints'
          ? (workbench.constraint?.name ?? 'Supports')
          : section === 'loads'
            ? (workbench.load?.name ?? 'Loads')
            : section === 'selections'
              ? (workbench.namedSelection?.name ?? 'Boundary sets')
              : sectionTitles[section];
  const selectedType =
    section === 'study'
      ? `${workbench.is2D ? '2D plane stress' : '3D solid'} · Static structural`
      : section === 'constraints' && workbench.constraint
        ? 'Displacement support'
        : section === 'loads' && workbench.load
          ? workbench.load.kind === 'force'
            ? 'Total force'
            : workbench.load.kind === 'pressure'
              ? 'Normal pressure'
              : 'Spatial vector traction'
          : section === 'selections' && workbench.namedSelection
            ? `${workbench.namedSelection.regions.length} saved boundaries`
            : section === 'results'
              ? 'Fields and diagnostics'
              : 'Selected model object';
  return (
    <aside id={panelId} className="properties-panel" aria-label={`${selectedName} properties`}>
      <div className="panel-heading inspector-heading">
        <span>{section === 'results' ? 'Result details' : 'Properties'}</span>
        <small>
          <ArrowDownLeft size={11} /> From model selection
        </small>
      </div>
      <div className="inspector-selection" aria-live="polite">
        <strong>{selectedName}</strong>
        <small>{selectedType}</small>
      </div>
      <div className="properties-scroll">
        <fieldset disabled={locked} key={`${project.id}:${project.displayUnits}`}>
          {section === 'study' && <StudyEditor workbench={workbench} />}
          {section === 'solver' && <SolverEditor workbench={workbench} />}
          {section === 'geometry' && <GeometryEditor workbench={workbench} />}
          {section === 'selections' && <NamedSelectionEditor workbench={workbench} />}
          {section === 'material' && <MaterialEditor workbench={workbench} />}
          {section === 'mesh' && <MeshEditor workbench={workbench} />}
          {section === 'constraints' && <SupportEditor workbench={workbench} />}
          {section === 'loads' && <LoadEditor workbench={workbench} />}
        </fieldset>
        {section === 'results' && <ResultsInspector workbench={workbench} />}
      </div>
      {busy && (
        <div className="properties-footer">
          <LockKeyhole size={12} /> Inputs locked while worker runs
        </div>
      )}
    </aside>
  );
}
