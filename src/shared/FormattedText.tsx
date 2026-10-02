import { lazy, Suspense } from 'react';
const AcademicMarkdown = lazy(() => import('./AcademicMarkdown'));

// Load the Markdown/math parser only when a help article or reply is displayed.
export default function FormattedText(props: {
  children: string;
  onSource?: (id: string) => void;
  onExternal?: (url: string) => void;
}) {
  return (
    <Suspense fallback={<div style={{ whiteSpace: 'pre-wrap' }}>{props.children}</div>}>
      <AcademicMarkdown {...props} />
    </Suspense>
  );
}
