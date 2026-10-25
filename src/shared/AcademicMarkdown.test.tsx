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

it('keeps math links untrusted when prototype metadata is polluted', () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, 'processor');
  let value: string;
  try {
    Object.defineProperty(Object.prototype, 'processor', {
      configurable: true,
      value: (option: unknown) => (option === false ? true : option),
    });
    value = renderToStaticMarkup(
      <AcademicMarkdown>{String.raw`$$\href{https://example.test}{unsafe}$$`}</AcademicMarkdown>,
    );
  } finally {
    if (original) Object.defineProperty(Object.prototype, 'processor', original);
    else Reflect.deleteProperty(Object.prototype, 'processor');
  }
  expect(value).toContain('katex');
  expect(value).not.toContain('href="https://example.test');
});
