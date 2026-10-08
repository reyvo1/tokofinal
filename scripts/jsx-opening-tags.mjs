// Read tag attributes without treating a JSX expression's `>` as the tag's end.
export function jsxOpeningTags(source, tag) {
  const matches = [];
  const start = new RegExp(`<${tag}\\b`, 'g');
  for (const match of source.matchAll(start)) {
    let depth = 0;
    let quote = null;
    const from = match.index + match[0].length;
    for (let i = from; i < source.length; i += 1) {
      const char = source[i];
      if (quote) {
        if (char === '\\') { i += 1; continue; }
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (char === '>' && depth === 0) {
        matches.push({ attrs: source.slice(from, i), index: match.index });
        break;
      }
    }
  }
  return matches;
}
