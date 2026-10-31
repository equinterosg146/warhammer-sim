export type Row = Record<string, string>;

export interface Table {
  name: string;
  columns: string[];
  rows: Row[];
}

/** Wahapedia exports: pipe-delimited, UTF-8 BOM, trailing pipe, one record per line. */
export function parseCsv(name: string, text: string): Table {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error(`${name}: file is empty`);
  const columns = splitLine(lines[0]).map((c) => c.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Row = {};
    columns.forEach((col, i) => {
      row[col] = (cells[i] ?? '').trim();
    });
    return row;
  });
  return { name, columns, rows };
}

function splitLine(line: string): string[] {
  const cells = line.split('|');
  if (cells[cells.length - 1] === '') cells.pop();
  return cells;
}

export function requireColumns(table: Table, columns: string[]): void {
  const missing = columns.filter((c) => !table.columns.includes(c));
  if (missing.length > 0) {
    throw new Error(
      `${table.name}: missing column(s) ${missing.join(', ')}. Found: ${table.columns.join(', ')}. ` +
        'The Wahapedia export format may have changed.',
    );
  }
}
