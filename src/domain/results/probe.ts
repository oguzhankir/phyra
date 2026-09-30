export type Probe = {
  association: 'node' | 'cell';
  id: number;
  value: number;
  units: string;
  position: [number, number, number];
  region: string;
};
