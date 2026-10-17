import { COLUMNS } from './lib/columns.js';
import { display } from './lib/format.js';

const ARIA_SORT = { asc: 'ascending', desc: 'descending' };
const ARROW = { asc: '▲', desc: '▼' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Builds the header row once; returns a function that refreshes sort indicators. */
export function createHeader(thead, onSort) {
  const tr = el('tr');
  const cells = COLUMNS.map((column) => {
    const th = el('th');
    th.scope = 'col';
    if (column.numeric) th.classList.add('num');
    const indicator = el('span', 'sort-indicator');
    indicator.setAttribute('aria-hidden', 'true');
    const button = el('button', 'sort-button');
    button.type = 'button';
    button.append(el('span', null, column.label), indicator);
    button.addEventListener('click', () => onSort(column.id));
    th.append(button);
    tr.append(th);
    return { column, th, indicator };
  });
  thead.replaceChildren(tr);

  return (sort) => {
    for (const { column, th, indicator } of cells) {
      const active = column.id === sort.columnId;
      if (active) th.setAttribute('aria-sort', ARIA_SORT[sort.direction]);
      else th.removeAttribute('aria-sort');
      indicator.textContent = active ? ARROW[sort.direction] : '';
    }
  };
}

export function renderMessage(tbody, text, className) {
  const tr = el('tr', className);
  const td = el('td', null, text);
  td.colSpan = COLUMNS.length;
  tr.append(td);
  tbody.replaceChildren(tr);
}

export function renderRows(tbody, rows) {
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = el('tr');
    for (const column of COLUMNS) {
      const isName = column.id === 'name';
      const value = row[column.field];
      const cell = el(isName ? 'th' : 'td', null, display(value));
      if (isName) cell.scope = 'row';
      if (column.numeric) cell.classList.add('num');
      if (value === null || value === undefined) cell.classList.add('missing');
      const flag = row.flags?.[column.field];
      if (flag) {
        const mark = el('span', 'review-flag', '⚑');
        mark.title = flag;
        mark.setAttribute('role', 'img');
        mark.setAttribute('aria-label', flag);
        cell.append(' ', mark);
      }
      tr.append(cell);
    }
    fragment.append(tr);
  }
  tbody.replaceChildren(fragment);
}
