import React, { useEffect } from 'react';

export const MC_COLORS: Record<string, string> = {
  '0': '#000000',
  '1': '#0000AA',
  '2': '#00AA00',
  '3': '#00AAAA',
  '4': '#AA0000',
  '5': '#AA00AA',
  '6': '#FFAA00',
  '7': '#AAAAAA',
  '8': '#555555',
  '9': '#5555FF',
  a: '#55FF55',
  b: '#55FFFF',
  c: '#FF5555',
  d: '#FF55FF',
  e: '#FFFF55',
  f: '#FFFFFF',
};

export interface McRun {
  text: string;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

export function parseMinecraft(input: string, defaultColor = '#FFFFFF'): McRun[] {
  const text = (input ?? '').replace(/\u00a7/g, '&');
  const runs: McRun[] = [];
  let color = defaultColor;
  let bold = false;
  let italic = false;
  let underline = false;
  let strike = false;

  const push = (chunk: string) => {
    if (!chunk) return;
    const last = runs[runs.length - 1];
    if (last && last.color === color && last.bold === bold && last.italic === italic && last.underline === underline && last.strike === strike) {
      last.text += chunk;
      return;
    }
    runs.push({ text: chunk, color, bold, italic, underline, strike });
  };

  let i = 0;
  let buffer = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '&' && i + 1 < text.length) {
      const hexMatch = /^&#([0-9a-fA-F]{6})/.exec(text.slice(i));
      if (hexMatch) {
        push(buffer);
        buffer = '';
        color = `#${hexMatch[1]}`;
        i += hexMatch[0].length;
        continue;
      }
      const code = text[i + 1].toLowerCase();
      if (MC_COLORS[code]) {
        push(buffer);
        buffer = '';
        color = MC_COLORS[code];
        i += 2;
        continue;
      }
      if (code === 'r') {
        push(buffer);
        buffer = '';
        color = defaultColor;
        bold = italic = underline = strike = false;
        i += 2;
        continue;
      }
      if (code === 'l' || code === 'o' || code === 'n' || code === 'm' || code === 'k') {
        push(buffer);
        buffer = '';
        if (code === 'l') bold = true;
        if (code === 'o') italic = true;
        if (code === 'n') underline = true;
        if (code === 'm') strike = true;
        if (code === 'k') italic = true;
        i += 2;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  push(buffer);
  return runs;
}

export function McText({
  text,
  className,
  defaultColor,
}: {
  text: string;
  className?: string;
  defaultColor?: string;
}) {
  const runs = parseMinecraft(text, defaultColor);
  return (
    <span className={className}>
      {runs.map((run, index) => (
        <span
          key={index}
          style={{
            color: run.color,
            fontWeight: run.bold ? 700 : undefined,
            fontStyle: run.italic ? 'italic' : undefined,
            textDecoration: [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
          }}
        >
          {run.text}
        </span>
      ))}
    </span>
  );
}

export function UnsavedDot({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="inline-block h-2 w-2 rounded-full bg-amber-400" title="Unsaved changes" />;
}

export function useEscape(handler: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handler();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handler, active]);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDate(iso: string | null | undefined, lang = 'en'): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}
