import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AcademicMarkdown from './AcademicMarkdown';

it('renders academic equations and offline citations without external images or active HTML', () => {
  const value = renderToStaticMarkup(
    <AcademicMarkdown
      onSource={() => {}}
    >{String.raw`$$\sigma=\lambda\operatorname{tr}(\varepsilon)I+2\mu\varepsilon$$

[Method](#help:fem-3d) ![remote](https://example.test/tracker)

<script>alert(1)</script> [bad](javascript:alert(1))

$$\href{https://example.test}{unsafe}$$`}</AcademicMarkdown>,
  );
  expect(value).toContain('katex');
  expect(value).toContain('Method</button>');
  expect(value).not.toContain('<script');
  expect(value).not.toContain('<img');
  expect(value).not.toContain('javascript:');
  expect(value).not.toContain('href="https://example.test');
});
