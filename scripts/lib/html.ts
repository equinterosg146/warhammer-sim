import type { Rich, RichNode } from '../../src/data/types';

interface El {
  tag: string;
  cls: string;
  children: (El | string)[];
}

const VOID_TAGS = new Set(['br', 'hr', 'img']);
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

function parseTree(html: string): El {
  const root: El = { tag: 'root', cls: '', children: [] };
  const stack: El[] = [root];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const top = () => stack[stack.length - 1];
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) top().children.push(decodeEntities(html.slice(last, m.index)));
    last = re.lastIndex;
    const tag = m[1].toLowerCase();
    if (m[0][1] === '/') {
      // Close up to the nearest matching open tag; ignore stray closers.
      const idx = stack.map((e) => e.tag).lastIndexOf(tag);
      if (idx > 0) stack.length = idx;
      continue;
    }
    const cls = /class\s*=\s*"([^"]*)"/.exec(m[2])?.[1] ?? '';
    const el: El = { tag, cls, children: [] };
    top().children.push(el);
    if (!VOID_TAGS.has(tag) && !m[2].trim().endsWith('/')) stack.push(el);
  }
  if (last < html.length) top().children.push(decodeEntities(html.slice(last)));
  return root;
}

const isBlock = (n: RichNode) => n.t === 'p' || n.t === 'ul' || n.t === 'table';

function inlineWrap(t: 'b' | 'i' | 'u' | 'kw', c: Rich): Rich {
  if (c.length === 0) return [];
  // Inline wrappers cannot hold blocks; keep the content, drop the styling.
  if (c.some(isBlock)) return c;
  return [{ t, c }];
}

function convert(children: (El | string)[]): Rich {
  const out: Rich = [];
  for (const child of children) {
    if (typeof child === 'string') {
      const v = child.replace(/\s+/g, ' ');
      if (v !== '') out.push({ t: 'text', v });
      continue;
    }
    out.push(...convertEl(child));
  }
  return out;
}

// Wahapedia wraps core rules in a header block that repeats the name, rule number and legend.
const DROPPED_CLASSES = /\b(abNameWrap|abLegend|abIcon|h_number)\b/;

function convertEl(el: El): Rich {
  if (DROPPED_CLASSES.test(el.cls)) return [];
  switch (el.tag) {
    case 'br':
      return [{ t: 'br' }];
    case 'b':
    case 'strong':
      return inlineWrap('b', convert(el.children));
    case 'i':
    case 'em':
      return inlineWrap('i', convert(el.children));
    case 'u':
      return inlineWrap('u', convert(el.children));
    case 'span':
      return /\bkwb/.test(el.cls) ? inlineWrap('kw', convert(el.children)) : convert(el.children);
    case 'ul':
    case 'ol': {
      const items = el.children
        .filter((c): c is El => typeof c !== 'string' && c.tag === 'li')
        .map((li) => tidy(convert(li.children)))
        .filter((item) => item.length > 0);
      return items.length > 0 ? [{ t: 'ul', items }] : [];
    }
    case 'table': {
      const rows: Rich[][] = [];
      const walk = (node: El) => {
        for (const c of node.children) {
          if (typeof c === 'string') continue;
          if (c.tag === 'tr') {
            const cells = c.children
              .filter((x): x is El => typeof x !== 'string' && (x.tag === 'td' || x.tag === 'th'))
              .map((cell) => tidy(convert(cell.children)));
            if (cells.length > 0) rows.push(cells);
          } else {
            walk(c);
          }
        }
      };
      walk(el);
      return rows.length > 0 ? [{ t: 'table', rows }] : [];
    }
    case 'p':
    case 'div': {
      const c = tidy(convert(el.children));
      if (c.length === 0) return [];
      // A wrapper around a single paragraph adds nothing.
      if (c.length === 1 && c[0].t === 'p') return c;
      return [{ t: 'p', c }];
    }
    case 'hr':
    case 'img':
    case 'script':
    case 'style':
      return [];
    default:
      return convert(el.children);
  }
}

/** Merge adjacent text, trim edge whitespace and line breaks, collapse 3+ breaks to 2. */
function tidy(nodes: Rich): Rich {
  const merged: Rich = [];
  for (const n of nodes) {
    const prev = merged[merged.length - 1];
    if (n.t === 'text' && prev?.t === 'text') {
      prev.v = (prev.v + n.v).replace(/ +/g, ' ');
    } else if (n.t === 'br' && prev?.t === 'br' && merged[merged.length - 2]?.t === 'br') {
      continue;
    } else {
      merged.push(n.t === 'text' ? { ...n } : n);
    }
  }
  const isEdge = (n: RichNode | undefined) => n !== undefined && (n.t === 'br' || (n.t === 'text' && n.v.trim() === ''));
  while (isEdge(merged[0])) merged.shift();
  while (isEdge(merged[merged.length - 1])) merged.pop();
  // A line break next to a block adds nothing: blocks already start on their own line.
  const out = merged.filter((n, i) => {
    if (n.t !== 'br') return true;
    const next = merged[i + 1];
    const prev = merged[i - 1];
    return !((next && isBlock(next)) || (prev && isBlock(prev)));
  });
  const first = out[0];
  if (first?.t === 'text') first.v = first.v.trimStart();
  const lastNode = out[out.length - 1];
  if (lastNode?.t === 'text') lastNode.v = lastNode.v.trimEnd();
  return out;
}

export function htmlToRich(html: string): Rich {
  if (!html) return [];
  return tidy(convert(parseTree(html).children));
}

/** Plain-text rendering, used for search and for fields that should never carry markup. */
export function richToText(nodes: Rich): string {
  return nodes
    .map((n): string => {
      switch (n.t) {
        case 'text':
          return n.v;
        case 'br':
          return '\n';
        case 'ul':
          return '\n' + n.items.map((i) => '- ' + richToText(i)).join('\n') + '\n';
        case 'table':
          return '\n' + n.rows.map((r) => r.map(richToText).join(' | ')).join('\n') + '\n';
        case 'p':
          return '\n' + richToText(n.c) + '\n';
        default:
          return richToText(n.c);
      }
    })
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
