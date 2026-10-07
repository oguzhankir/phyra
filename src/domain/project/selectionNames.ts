// ASCII case folding is identical in the native/Python validators and does not
// depend on the user's locale. Non-ASCII labels retain their authored identity.
export function selectionNameKey(name: string): string {
  // Explicit shared whitespace policy, including BOM and separator controls;
  // JS trim(), Python strip() and Rust trim() do not recognize identical sets.
  const whitespace =
    '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]';
  return name
    .replace(new RegExp(`^${whitespace}+|${whitespace}+$`, 'g'), '')
    .replace(/[A-Z]/g, (character) => character.toLowerCase());
}
