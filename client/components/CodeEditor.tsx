import React, { useEffect, useMemo, useRef } from 'react';

type Format = 'yaml' | 'json' | 'toml' | 'text';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const TOKEN_RE = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\btrue\b|\bfalse\b|\bnull\b|-?\b\d+(?:\.\d+)?\b|[{}[\],:=-])/g;

function highlightCodePart(part: string, format: Format): string {
  if (part === '') return '';
  if (format === 'text') return escapeHtml(part);
  let result = '';
  let lastIndex = 0;
  const keyRe = format === 'yaml' || format === 'toml' || format === 'json' ? /^(\s*)([A-Za-z0-9_.\-"'[\]]+)(\s*[:=])/ : null;
  const keyMatch = keyRe ? keyRe.exec(part) : null;
  if (keyMatch) {
    result += escapeHtml(keyMatch[1]);
    result += `<span class="text-sky-300">${escapeHtml(keyMatch[2])}</span>`;
    result += `<span class="text-slate-500">${escapeHtml(keyMatch[3])}</span>`;
    lastIndex = keyMatch[0].length;
  }
  const rest = part.slice(lastIndex);
  let cursor = 0;
  rest.replace(TOKEN_RE, (match, _group: string, offset: number) => {
    result += escapeHtml(rest.slice(cursor, offset));
    if (/^["']/.test(match)) result += `<span class="text-emerald-300">${escapeHtml(match)}</span>`;
    else if (/^(true|false|null)$/.test(match)) result += `<span class="text-purple-300">${escapeHtml(match)}</span>`;
    else if (/^-?\d/.test(match)) result += `<span class="text-orange-300">${escapeHtml(match)}</span>`;
    else result += `<span class="text-slate-500">${escapeHtml(match)}</span>`;
    cursor = offset + match.length;
    return match;
  });
  result += escapeHtml(rest.slice(cursor));
  return result;
}

function highlight(code: string, format: Format): string {
  return code
    .split('\n')
    .map((line) => {
      // Locate a comment marker outside quotes.
      let inSingle = false;
      let inDouble = false;
      let commentIndex = -1;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '\\' && (inSingle || inDouble)) {
          i += 1;
          continue;
        }
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (!inSingle && !inDouble && ch === '#') {
          commentIndex = i;
          break;
        }
      }
      if (commentIndex >= 0) {
        const before = line.slice(0, commentIndex);
        const comment = line.slice(commentIndex);
        return `${highlightCodePart(before, format)}<span class="text-slate-500 italic">${escapeHtml(comment)}</span>`;
      }
      return highlightCodePart(line, format);
    })
    .join('\n');
}

export function CodeEditor({
  value,
  onChange,
  format,
  readOnly,
  wordWrap,
  height = 'min-h-[420px]',
  fileName,
}: {
  value: string;
  onChange: (value: string) => void;
  format: Format;
  readOnly?: boolean;
  wordWrap?: boolean;
  height?: string;
  fileName?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => value.split('\n'), [value]);
  const highlighted = useMemo(() => highlight(value, format), [value, format]);

  const syncScroll = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (preRef.current) {
      preRef.current.scrollTop = textarea.scrollTop;
      preRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
  };

  useEffect(() => {
    syncScroll();
  }, [value]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-surface-700 bg-surface-950" aria-label={fileName ? `Editor for ${fileName}` : 'Configuration editor'}>
      <div className="flex items-stretch" style={{ maxHeight: '70vh' }}>
        <div ref={gutterRef} className="hidden shrink-0 overflow-hidden border-r border-surface-800 bg-surface-900/60 py-3 text-right select-none sm:block">
          {lines.map((_, index) => (
            <div key={index} className="code-font px-2 text-slate-600">
              {index + 1}
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <pre
            ref={preRef}
            aria-hidden="true"
            className={`code-font pointer-events-none m-0 h-full overflow-hidden p-3 text-slate-300 ${wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'} ${height}`}
            dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }}
          />
          <textarea
            ref={textareaRef}
            spellCheck={false}
            readOnly={readOnly}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            aria-label={fileName ?? 'Configuration content'}
            className={`code-font absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-3 text-transparent caret-slate-100 outline-none selection:bg-accent/30 ${
              wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
            }`}
          />
        </div>
      </div>
    </div>
  );
}
