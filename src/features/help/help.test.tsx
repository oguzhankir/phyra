import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelpPanel } from './HelpPanel';
import { getContextArticle, helpArticles, helpCategories, type HelpContext } from './content';
import { articleText, searchHelp } from './search';

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
});
