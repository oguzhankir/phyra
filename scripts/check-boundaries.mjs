import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowed = {
  domain: ['domain'],
  platform: ['platform', 'domain'],
  shared: ['shared', 'domain'],
  features: ['features', 'shared', 'domain', 'platform'],
  app: ['app', 'features', 'shared', 'domain', 'platform'],
};
export function boundaryViolation(from, to) {
  const source = from.replaceAll('\\', '/');
  const target = to.replaceAll('\\', '/');
  const layer = source.split('/')[1];
  if (target.startsWith('@tauri-apps/') && layer !== 'platform')
    return 'Native APIs belong to platform adapters.';
  if (!target.startsWith('src/')) {
    if (layer === 'domain' && !target.startsWith('contracts/') && target !== '')
      return 'Domain code may depend only on domain contracts and values.';
    return null;
  }
  const targetLayer = target.split('/')[1];
  if (
    source.startsWith('src/features/assistant/') &&
    targetLayer === 'features' &&
    !target.startsWith('src/features/assistant/') &&
    !target.startsWith('src/features/help/')
  )
    return 'The assistant receives host snapshots; it may reuse offline help but not workbench feature state.';
  if (source === 'src/main.tsx')
    return targetLayer === 'app'
      ? null
      : 'The entry point composes only the application bootstrap.';
  return allowed[layer]?.includes(targetLayer)
    ? null
    : `${layer ?? 'Unowned'} code cannot depend on ${targetLayer}.`;
}
export function checkBoundaries() {
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const failures = [];
  let count = 0;
  for (const filename of parsed.fileNames) {
    const relative = path.relative(root, filename).replaceAll('\\', '/');
    if (
      !relative.startsWith('src/') ||
      /\.(test|generated)\.[^.]+$/.test(relative) ||
      filename.endsWith('.d.ts')
    )
      continue;
    count++;
    const file = ts.createSourceFile(
      filename,
      fs.readFileSync(filename, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const inspect = (specifier, node) => {
      if (!ts.isStringLiteralLike(specifier)) {
        failures.push(`${relative}: computed module imports are not statically owned.`);
        return;
      }
      const resolved = ts.resolveModuleName(specifier.text, filename, parsed.options, ts.sys)
        .resolvedModule?.resolvedFileName;
      const target =
        resolved && !resolved.includes('/node_modules/')
          ? path.relative(root, resolved).replaceAll('\\', '/')
          : specifier.text;
      const problem = boundaryViolation(relative, target);
      if (problem) {
        const location = file.getLineAndCharacterOfPosition(node.getStart(file));
        failures.push(`${relative}:${location.line + 1} → ${target}: ${problem}`);
      }
    };
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        inspect(node.moduleSpecifier, node);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        inspect(node.arguments[0], node);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  if (failures.length) throw new Error(`Frontend ownership violations:\n${failures.join('\n')}`);
  return count;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(`Frontend ownership: ${checkBoundaries()} production modules checked.`);
