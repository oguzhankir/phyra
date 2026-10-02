import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './AcademicMarkdown.css';

export default function AcademicMarkdown({
  children,
  onSource,
  onExternal,
}: {
  children: string;
  onSource?: (id: string) => void;
  onExternal?: (url: string) => void;
}) {
  return (
    <div className="academic-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            { trust: false, strict: 'error', maxExpand: 1000, maxSize: 20, throwOnError: false },
          ],
        ]}
        urlTransform={(url) => (/^(https?:\/\/|#help:)/i.test(url) ? url : '')}
        components={{
          img: ({ alt }) => <span>[Image omitted{alt ? `: ${alt}` : ''}]</span>,
          a: ({ href, children: label }) =>
            href?.startsWith('#help:') && onSource ? (
              <button type="button" className="text-button" onClick={() => onSource(href.slice(6))}>
                {label}
              </button>
            ) : href && onExternal ? (
              <button
                type="button"
                className="text-button"
                title={href}
                onClick={() => onExternal(href)}
              >
                {label}
              </button>
            ) : href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {label}
              </a>
            ) : (
              <span>{label}</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
