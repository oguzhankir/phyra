import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Search, X } from 'lucide-react';
import {
  getContextArticle,
  getHelpArticle,
  helpCategories,
  type HelpArticleId,
  type HelpContext,
} from './content';
import { searchHelp } from './search';
import './HelpPanel.css';

export interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
  context?: HelpContext;
}

export function HelpPanel({ open, onClose, context = 'overview' }: HelpPanelProps) {
  const [copiedSource, setCopiedSource] = useState<string | null>(null);
  const desktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<HelpArticleId>(() => getContextArticle(context).id);
  const [showArticle, setShowArticle] = useState(true);
  const contentRef = useRef<HTMLElement>(null);
  const searchId = useId();
  const articleTitleId = useId();
  const results = useMemo(() => searchHelp(query), [query]);
  const article = getHelpArticle(activeId);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveId(getContextArticle(context).id);
    setShowArticle(true);
  }, [open, context]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeId]);

  function selectArticle(id: HelpArticleId) {
    setActiveId(id);
    setShowArticle(true);
  }

  if (!open) return null;

  return (
    <section className="help-panel" aria-label="Workbench help">
      <header className="help-header">
        <div className="help-heading">
          <BookOpen size={20} aria-hidden="true" />
          <div>
            <h2>Workbench help</h2>
            <p>Current capabilities · available offline</p>
          </div>
        </div>
        <button className="help-close" type="button" onClick={onClose} aria-label="Close help">
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="help-search">
        <label htmlFor={searchId}>Find a guide, method or answer</label>
        <div className="help-search-field">
          <Search size={17} aria-hidden="true" />
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder="Try pressure, plane stress or export"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setShowArticle(false);
            }}
          />
          {query && (
            <button
              className="help-clear"
              type="button"
              aria-label="Clear help search"
              onClick={() => setQuery('')}
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className={`help-body ${showArticle ? 'help-body-reading' : 'help-body-browsing'}`}>
        <nav
          className="help-navigation"
          aria-label={query.trim() ? 'Help search results' : 'Help topics'}
        >
          {query.trim() ? (
            <>
              <p className="help-results-count" role="status">
                {results.length} {results.length === 1 ? 'answer' : 'answers'}
              </p>
              {results.length ? (
                results.map((result) => (
                  <button
                    className={`help-topic ${activeId === result.id ? 'help-topic-active' : ''}`}
                    key={result.id}
                    type="button"
                    aria-current={activeId === result.id ? 'page' : undefined}
                    onClick={() => selectArticle(result.id)}
                  >
                    <span>{result.title}</span>
                    <small>{result.summary}</small>
                  </button>
                ))
              ) : (
                <div className="help-no-results">
                  <strong>No matching guide</strong>
                  <p>
                    Try fewer words, such as force, supports or training. This search covers the
                    current release.
                  </p>
                  <button type="button" onClick={() => setQuery('')}>
                    Browse all topics
                  </button>
                </div>
              )}
            </>
          ) : (
            helpCategories.map((category) => (
              <div className="help-category" key={category}>
                <h3>{category}</h3>
                {results
                  .filter((result) => result.category === category)
                  .map((result) => (
                    <button
                      className={`help-topic ${activeId === result.id ? 'help-topic-active' : ''}`}
                      key={result.id}
                      type="button"
                      aria-current={activeId === result.id ? 'page' : undefined}
                      onClick={() => selectArticle(result.id)}
                    >
                      <span>{result.title}</span>
                      {result.experimental && <small>Experimental method</small>}
                    </button>
                  ))}
              </div>
            ))
          )}
        </nav>

        <article className="help-article" ref={contentRef} aria-labelledby={articleTitleId}>
          <button type="button" className="help-back" onClick={() => setShowArticle(false)}>
            <ArrowLeft size={15} aria-hidden="true" /> Browse topics
          </button>
          <div className="help-article-meta">
            <span>
              {article.category} / {article.kind}
            </span>
            {article.experimental && <span className="help-experimental">Experimental</span>}
          </div>
          <h2 id={articleTitleId}>{article.title}</h2>
          <p className="help-summary">{article.summary}</p>
          {article.sections.map((section) => (
            <section className="help-section" key={section.title}>
              <h3>{section.title}</h3>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.steps && (
                <ol>
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {section.bullets && (
                <ul>
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {section.facts && (
                <dl className="help-facts">
                  {section.facts.map((fact) => (
                    <div key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {section.references && (
                <div className="help-references">
                  {section.references.map((reference) => (
                    <article key={reference.url}>
                      <strong>{reference.title}</strong>
                      <small>
                        {reference.authors}
                        {reference.year ? ` · ${reference.year}` : ''}
                      </small>
                      <p>{reference.scope}</p>
                      {desktop ? (
                        <button
                          className="text-button"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(reference.url)
                              .then(() => setCopiedSource(reference.url))
                              .catch(() => setCopiedSource('unavailable'))
                          }
                        >
                          {copiedSource === reference.url
                            ? 'Source link copied'
                            : 'Copy source link'}
                        </button>
                      ) : (
                        <a href={reference.url} target="_blank" rel="noopener noreferrer">
                          Read primary source <ArrowRight size={12} />
                        </a>
                      )}
                      <code>{reference.url}</code>
                    </article>
                  ))}
                  {copiedSource === 'unavailable' && (
                    <p role="status">Copying is unavailable. Select the displayed source URL.</p>
                  )}
                </div>
              )}
              {section.screenshots?.map((image) => (
                <figure className="help-screenshot" key={image.src}>
                  <img src={image.src} alt={image.alt} loading="lazy" />
                  <figcaption>{image.caption}</figcaption>
                </figure>
              ))}
              {section.note && (
                <aside className={`help-note help-note-${section.note.tone}`}>
                  <strong>
                    {section.note.tone === 'warning' ? 'Interpret with care' : 'Keep in mind'}
                  </strong>
                  <p>{section.note.text}</p>
                </aside>
              )}
            </section>
          ))}
          <footer className="help-related">
            <h3>Continue reading</h3>
            {article.related.map((id) => (
              <button key={id} type="button" onClick={() => selectArticle(id)}>
                {getHelpArticle(id).title}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            ))}
          </footer>
        </article>
      </div>
    </section>
  );
}

export default HelpPanel;
