import { helpArticles, type HelpArticle } from './content';

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function articleText(article: HelpArticle): string {
  return article.sections
    .flatMap((section) => [
      section.title,
      ...(section.paragraphs ?? []),
      ...(section.steps ?? []),
      ...(section.bullets ?? []),
      ...(section.facts ?? []).map((fact) => `${fact.label} ${fact.value}`),
      section.note?.text ?? '',
    ])
    .join(' ');
}

export function searchHelp(query: string): HelpArticle[] {
  const tokens = [...new Set(normalize(query).split(' ').filter(Boolean))];
  if (!tokens.length) return [...helpArticles];
  return helpArticles
    .map((article, order) => {
      const title = normalize(article.title);
      const keywords = normalize(article.keywords.join(' '));
      const summary = normalize(article.summary);
      const body = normalize(articleText(article));
      const fields = [title, keywords, summary, body];
      if (!tokens.every((token) => fields.some((field) => field.includes(token)))) return null;
      const score = tokens.reduce(
        (sum, token) =>
          sum +
          (title.includes(token) ? 8 : 0) +
          (keywords.includes(token) ? 5 : 0) +
          (summary.includes(token) ? 3 : 0) +
          (body.includes(token) ? 1 : 0),
        0,
      );
      return { article, score, order };
    })
    .filter((item) => item !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((item) => item.article);
}
