import { CircleHelp, LockKeyhole } from 'lucide-react';
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
export default function PropertyInspector({ workbench }: { workbench: ProjectInspectorModel }) {
  const { rightWidth, section, showHelp, locked, project, fileBusy, busy, dirty } = workbench;
  return (
    <aside
      id="workbench-properties-panel"
      className="properties-panel"
      style={{ width: rightWidth }}
    >
      <div className="panel-heading">
        <span>
          {section === 'results'
            ? 'Result details'
            : `Edit ${sectionTitles[section].toLowerCase()}`}
        </span>
        <button
          className="property-help"
          aria-label={`Help with ${sectionTitles[section].toLowerCase()}`}
          title="Help with this editor"
          onClick={() => showHelp()}
        >
          <CircleHelp size={16} />
        </button>
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
      <div className="properties-footer">
        {fileBusy ? (
          <>
            <LockKeyhole size={12} />
            Project file operation in progress
          </>
        ) : busy ? (
          <>
            <LockKeyhole size={12} />
            Inputs locked while worker runs
          </>
        ) : (
          <>
            REV {project.revision}
            <span>{dirty ? 'Modified' : 'Unchanged'}</span>
          </>
        )}
      </div>
    </aside>
  );
}
