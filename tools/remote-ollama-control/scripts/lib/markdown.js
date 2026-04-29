'use strict';

function escapeCell(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');
}

function table(headers, rows) {
  const lines = [];
  lines.push(`| ${headers.map(escapeCell).join(' | ')} |`);
  lines.push(`|${headers.map(() => '---').join('|')}|`);
  for (const row of rows) {
    lines.push(`| ${row.map(escapeCell).join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

function fenced(value, lang = 'text') {
  return `\`\`\`${lang}\n${String(value || '')}\n\`\`\``;
}

module.exports = {
  fenced,
  table
};
