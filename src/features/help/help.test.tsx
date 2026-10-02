import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelpPanel } from './HelpPanel';
import { getContextArticle, helpArticles, helpCategories, type HelpContext } from './content';
import { articleText, searchHelp } from './search';
import AcademicMarkdown from '../../shared/AcademicMarkdown';
import { assistantContext, helpDocument, retrieveHelp } from '../assistant/context';
import { textBytes } from '../../domain/assistant/prompt';
import { version } from '../../../package.json';

describe('offline workbench help', () => {
  it('keeps every contextual and related topic reachable', () => {
    const identities = new Set(helpArticles.map((article) => article.id));
    expect(identities.size).toBe(helpArticles.length);
    for (const article of helpArticles) {
      expect(helpCategories).toContain(article.category);
      expect(article.sections.length).toBeGreaterThan(0);
      for (const related of article.related) expect(identities.has(related)).toBe(true);
    }
    const contexts: HelpContext[] = [
      'overview',
      'geometry',
      'selections',
      'material',
      'conditions',
      'constraints',
      'loads',
      'mesh',
      'study',
      'solver',
      'results',
      'runs',
      'files',
    ];
    for (const context of contexts)
      expect(identities.has(getContextArticle(context).id)).toBe(true);
    expect(getContextArticle('loads').id).toBe('loads');
    expect(getContextArticle('solver').id).toBe('solver');
  });

  it('finds physical terms across headings and detailed unit/sign explanations', () => {
    expect(searchHelp('pressure')[0].id).toBe('loads');
    expect(searchHelp('plane stress thickness').map((article) => article.id)).toContain('fem-2d');
    expect(searchHelp('prescribed free').map((article) => article.id)).toContain('supports');
    expect(searchHelp('optimizer state').map((article) => article.id)).toContain('files');
    expect(searchHelp('FLOAT32')[0].id).toBe('devices');
  });

  it('normalizes punctuation and repeated terms without treating user input as code', () => {
    expect(searchHelp('  pressure!!! pressure  ')).toEqual(searchHelp('pressure'));
    expect(searchHelp('')).toEqual(helpArticles);
    expect(searchHelp('   —   ')).toEqual(helpArticles);
    expect(searchHelp('pressure unavailable').map((article) => article.id)).not.toContain('loads');
    expect(searchHelp('<script>missing-topic</script>')).toEqual([]);
    expect(searchHelp('a topic that does not exist')).toEqual([]);
  });

  it('makes unsupported scope and experimental accuracy limits explicit', () => {
    const pinn = helpArticles.find((article) => article.id === 'pinn')!;
    expect(pinn.experimental).toBe(true);
    expect(articleText(pinn)).toContain('does not guarantee accurate fields');
    expect(articleText(helpArticles.find((article) => article.id === 'scope')!)).toContain(
      'not available in this release',
    );
    expect(articleText(helpArticles.find((article) => article.id === 'files')!)).toContain(
      'cannot resume training',
    );
  });

  it('renders contextual content with a labelled search and no active content when closed', () => {
    expect(renderToStaticMarkup(<HelpPanel open={false} onClose={() => {}} />)).toBe('');
    const markup = renderToStaticMarkup(<HelpPanel open onClose={() => {}} context="loads" />);
    expect(markup).toContain('Apply total force or pressure');
    expect(markup).toContain('Find a guide, method or answer');
    expect(markup).toContain('Close help');
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toContain('href="http');
  });
  it('indexes primary authors and renders fixed references with their scope', () => {
    expect(searchHelp('Perdikaris').map((article) => article.id)).toContain(
      'scientific-references',
    );
    expect(searchHelp('PyTorch').map((article) => article.id)).toContain('scientific-references');
    const article = helpArticles.find((article) => article.id === 'scientific-references')!;
    expect(article.sections.flatMap((section) => section.references ?? []).length).toBeGreaterThan(
      0,
    );
    expect(articleText(article)).toContain('Perdikaris');
  });

  it('keeps the exact implemented equations and primary citations in assistant retrieval', () => {
    const solid = helpArticles.find((article) => article.id === 'fem-3d')!;
    const plane = helpArticles.find((article) => article.id === 'fem-2d')!;
    const pinn = helpArticles.find((article) => article.id === 'pinn')!;
    expect(helpDocument(solid)).toContain(String.raw`\lambda=\frac{E\nu}{(1+\nu)(1-2\nu)}`);
    expect(helpDocument(solid)).toContain('Volume body force is zero');
    expect(helpDocument(solid)).toContain('Dirichlet');
    expect(helpDocument(solid)).toContain('https://dealii.org/current/doxygen/deal.II/step_8.html');
    expect(helpDocument(plane)).toContain(
      String.raw`\begin{bmatrix}1&\nu&0\\\nu&1&0\\0&0&(1-\nu)/2\end{bmatrix}`,
    );
    expect(helpDocument(plane)).toContain('engineering shear');
    expect(helpDocument(pinn)).toContain(String.raw`\mathcal L_{\mathrm{PDE}}&=\frac1{2N}`);
    expect(helpDocument(pinn)).toContain('All weights are 1');
    expect(helpDocument(pinn)).toContain('https://doi.org/10.1016/j.jcp.2018.10.045');
    expect(retrieveHelp('Lamé Dirichlet').map((article) => article.id)).toContain('fem-3d');
    expect(retrieveHelp('PINN exact loss').map((article) => article.id)).toContain('pinn');
    expect(searchHelp('10.1016/j.jcp.2018.10.045').map((article) => article.id)).toContain('pinn');
  });

  it('renders every scientific display equation without a math parser error', () => {
    const formulas = helpArticles.flatMap((article) =>
      article.sections.flatMap((section) =>
        (section.paragraphs ?? []).filter((text) => text.includes('$$')),
      ),
    );
    expect(formulas.length).toBeGreaterThanOrEqual(8);
    for (const formula of formulas) {
      const markup = renderToStaticMarkup(<AcademicMarkdown>{formula}</AcademicMarkdown>);
      expect(markup).toContain('katex-display');
      expect(markup).not.toContain('katex-error');
    }
  });

  it('retrieves governing equations from conversational English and Turkish questions', () => {
    const question = 'Explain the governing equations for this study.';
    expect(searchHelp(question)).toEqual([]);
    const solid = retrieveHelp(question, 'overview', '3d');
    expect(solid[0].id).toBe('fem-3d');
    expect(solid.map(helpDocument).join('\n\n')).toContain(String.raw`\lambda=\frac{E\nu}`);
    const plane = retrieveHelp(question, 'overview', '2d');
    expect(plane[0].id).toBe('fem-2d');
    expect(plane.map(helpDocument).join('\n\n')).toContain(String.raw`\begin{bmatrix}1&\nu&0`);
    expect(retrieveHelp('Bu çalışma için temel denklemleri açıkla.', 'overview', '2d')[0].id).toBe(
      'fem-2d',
    );
    expect(retrieveHelp('Üç boyutlu elastisite denklemlerini açıklar mısın?')[0].id).toBe('fem-3d');
    expect(retrieveHelp('Düzlem gerilme formülasyonunu ve gerinim tanımını anlat.')[0].id).toBe(
      'fem-2d',
    );
    expect(retrieveHelp('PINN kayıp fonksiyonunu ve ölçeklenmiş kalıntıları açıkla.')[0].id).toBe(
      'pinn',
    );
    expect(retrieveHelp('What is plane stress?', 'overview', '3d')[0].id).toBe('fem-2d');
  });

  it('bounds retrieved documents in UTF-8 bytes and identifies the installed version', () => {
    for (const question of [
      'Explain PINN governing equations, elasticity, normalization and weak form.',
      'Düzlem gerilme, gerinim ve fizik bilgili sinir ağı denklemlerini açıkla.',
      'Explain geometry, loads, material, units and the source references.',
    ]) {
      const documents = retrieveHelp(question, 'overview', '2d');
      const content = documents.map(helpDocument).join('\n\n');
      expect(textBytes(content)).toBeLessThanOrEqual(24000);
      expect(new Set(documents.map((article) => article.id)).size).toBe(documents.length);
    }
    const context = assistantContext('Explain the governing equations.', null, false);
    expect(context.text).toContain(`Phyra ${version} offline documentation`);
    expect(context.text).toContain('No private project or numerical field data is attached.');
  });

  it('finds current assistant privacy and MCP scope limits without promising agent mutations', () => {
    expect(searchHelp('Gemini BYOK')[0].id).toBe('assistant');
    expect(searchHelp('MCP stdio')[0].id).toBe('local-mcp');
    const assistant = articleText(helpArticles.find((article) => article.id === 'assistant')!);
    expect(assistant).toContain('128 KiB');
    expect(assistant).toContain('160 messages and 2 MiB');
    expect(assistant).toContain('Keys are scoped by provider and endpoint origin');
    expect(assistant).toContain('No local file path');
    const mcp = articleText(helpArticles.find((article) => article.id === 'local-mcp')!);
    expect(mcp).toContain('2025-11-25');
    expect(mcp).toContain('90 seconds');
    expect(mcp).toContain('no model mutations');
    expect(articleText(helpArticles.find((article) => article.id === 'about')!)).toContain(
      'https://github.com/oguzhankir/phyra',
    );
  });
});
