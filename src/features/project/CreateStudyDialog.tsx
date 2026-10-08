import { useRef, useState } from 'react';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import { lengthFactor } from '../../domain/units';
import type { ProjectDefinition } from '../../domain/contracts/types';

export default function CreateStudyDialog({
  dimension,
  units,
  defaultSize,
  previousStudy,
  replacing,
  locked,
  onCancel,
  onCreate,
}: {
  dimension: '2d' | '3d';
  units: 'm' | 'mm';
  defaultSize?: number;
  previousStudy: ProjectDefinition['study'];
  replacing: boolean;
  locked: boolean;
  onCancel: () => void;
  onCreate: (
    material: { name: string; young: number; poisson: number },
    thickness: number,
    size: number,
  ) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useModalFocus(true, onCancel, undefined, dialog);
  const factor = lengthFactor(units);
  const [name, setName] = useState(previousStudy?.material.name ?? ''),
    [young, setYoung] = useState(previousStudy ? String(previousStudy.material.young) : ''),
    [poisson, setPoisson] = useState(previousStudy ? String(previousStudy.material.poisson) : ''),
    [thickness, setThickness] = useState(''),
    [mesh, setMesh] = useState(defaultSize ? String(defaultSize * factor) : '');
  const e = Number(young),
    nu = Number(poisson),
    t = dimension === '2d' ? Number(thickness) / factor : 1,
    size = Number(mesh) / factor;
  const valid =
    name.trim().length > 0 &&
    young.trim() !== '' &&
    Number.isFinite(e) &&
    e > 0 &&
    e <= 1e15 &&
    poisson.trim() !== '' &&
    Number.isFinite(nu) &&
    nu > -1 &&
    nu <= 0.45 &&
    Number.isFinite(t) &&
    t > 0 &&
    t <= 1000 &&
    mesh.trim() !== '' &&
    Number.isFinite(size) &&
    size > 0 &&
    size <= 1000;
  return (
    <div className="modal-backdrop">
      <div
        className="modal overview-study-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-study-title"
        ref={dialog}
      >
        <form
          className="overview-study-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !locked) onCreate({ name: name.trim(), young: e, poisson: nu }, t, size);
          }}
        >
          <h2 id="create-study-title">
            {replacing ? 'Recreate' : 'Create'} a{' '}
            {dimension === '2d' ? 'plane-stress' : 'solid elasticity'} study
          </h2>
          <p>
            {replacing
              ? 'Recreate the study against the current faces. Existing supports and loads will be cleared; saved boundary sets remain available for explicit repair. Undo restores the previous study.'
              : 'Supply elastic properties for the intended material. Supports and loads start empty.'}
          </p>
          <p>
            Young’s modulus must be positive and at most 10¹⁵ Pa. Poisson’s ratio must be greater
            than −1 and at most 0.45 for this formulation.
          </p>
          <fieldset disabled={locked}>
            <label>
              Material name
              <input
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label>
              Young’s modulus · Pa
              <input
                inputMode="decimal"
                value={young}
                onChange={(event) => setYoung(event.target.value)}
                required
              />
            </label>
            <label>
              Poisson’s ratio
              <input
                inputMode="decimal"
                value={poisson}
                onChange={(event) => setPoisson(event.target.value)}
                required
              />
            </label>
            {dimension === '2d' && (
              <label>
                Study thickness · {units}
                <input
                  inputMode="decimal"
                  value={thickness}
                  onChange={(event) => setThickness(event.target.value)}
                  required
                />
              </label>
            )}
            <label>
              Target mesh size · {units}
              <input
                inputMode="decimal"
                value={mesh}
                onChange={(event) => setMesh(event.target.value)}
                required
              />
            </label>
            <div>
              <button type="button" className="secondary" onClick={onCancel}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={!valid}>
                {replacing ? 'Recreate study and clear assignments' : 'Create study'}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
