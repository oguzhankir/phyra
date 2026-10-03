import { compileFromFile } from 'json-schema-to-typescript';
import Ajv from 'ajv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Compile-time validation keeps dynamic code generation out of the desktop's
// restrictive content security policy. Imported files are validated natively.
const schema = JSON.parse(await readFile('contracts/project.schema.json', 'utf8'));
const validate = new Ajv({ strict: true }).compile(schema);
for (const name of [
  'cantilever',
  'cylinder',
  'bracket',
  'extension',
  'plane-stress-tension',
  'kirsch-quarter',
  'energy-tension',
  'eccentric-displacement',
  'energy-hole',
]) {
  const project = JSON.parse(await readFile(`examples/${name}.json`, 'utf8'));
  if (!validate(project)) {
    throw new Error(`Invalid bundled example ${name}: ${JSON.stringify(validate.errors)}`);
  }
}
await mkdir('src/domain/contracts', { recursive: true });
await writeFile(
  'src/domain/contracts/project.generated.ts',
  await compileFromFile('contracts/project.schema.json', {
    bannerComment: '/* Generated from contracts/project.schema.json. Run npm run generate. */',
    additionalProperties: false,
    maxItems: 3,
  }),
);
await writeFile(
  'src/domain/contracts/capabilities.generated.ts',
  await compileFromFile('contracts/engine-capabilities.schema.json', {
    bannerComment:
      '/* Generated from contracts/engine-capabilities.schema.json. Run npm run generate. */',
    additionalProperties: false,
  }),
);
