import { display } from './lib/format.js';

const ARIA_SORT = { asc: 'ascending', desc: 'descending' };
const ARROW = { asc: '▲', desc: '▼' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Returns a function that (re)builds the header for the given columns and sort indicators. */
export function createHeader(thead, onSort) {
  return (columns, sort) => {
    const tr = el('tr');
    for (const column of columns) {
      const th = el('th');
      th.scope = 'col';
      if (column.numeric) th.classList.add('num');
      const active = column.id === sort.columnId;
      if (active) th.setAttribute('aria-sort', ARIA_SORT[sort.direction]);
      const indicator = el('span', 'sort-indicator', active ? ARROW[sort.direction] : '');
      indicator.setAttribute('aria-hidden', 'true');
      const button = el('button', 'sort-button');
      button.type = 'button';
      button.append(el('span', null, column.label), indicator);
      button.addEventListener('click', () => onSort(column.id));
      th.append(button);
      tr.append(th);
    }
    thead.replaceChildren(tr);
  };
}

export function renderMessage(tbody, text, className, colSpan) {
  const tr = el('tr', className);
  const td = el('td', null, text);
  td.colSpan = colSpan;
  tr.append(td);
  tbody.replaceChildren(tr);
}

export function renderRows(tbody, rows, columns) {
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = el('tr');
    for (const column of columns) {
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
