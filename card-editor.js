const pageElement = document.querySelector('main.page');
const openFileButton = document.querySelector('#open-file');
const loadRepoDataButton = document.querySelector('#load-repo-data');
const saveFileButton = document.querySelector('#save-file');
const downloadFileButton = document.querySelector('#download-file');
const statusElement = document.querySelector('#status');
const tableBody = document.querySelector('#cards-table tbody');

let fileHandle = null;
let cards = [];

const repoDataPath = pageElement?.dataset.editorFilePath || 'data/wpg_player_rookie_cards.json';
const downloadFilename = pageElement?.dataset.downloadFilename || 'wpg_player_rookie_cards.edited.json';

function setStatus(message, type = '') {
  statusElement.textContent = message;
  statusElement.className = `status ${type}`.trim();
}

function parseCardData(data) {
  if (!Array.isArray(data)) {
    throw new Error('JSON must contain an array of card rows.');
  }

  return data.map((row) => ({
    playerId: Number(row.playerId) || 0,
    playerName: String(row.playerName || ''),
    isYG: Boolean(row.isYG),
    isOwned: Boolean(row.isOwned),
    set: String(row.set || ''),
    cardNumber: String(row.cardNumber || ''),
    comcUrl: String(row.comcUrl || row.comc_url || ''),
  }));
}

function renderTable() {
  tableBody.innerHTML = '';

  cards.forEach((card, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${card.playerId}</td>
      <td>${card.playerName}</td>
      <td>
        <select data-index="${index}" data-key="isYG">
          <option value="false" ${card.isYG ? '' : 'selected'}>false</option>
          <option value="true" ${card.isYG ? 'selected' : ''}>true</option>
        </select>
      </td>
      <td>
        <select data-index="${index}" data-key="isOwned">
          <option value="false" ${card.isOwned ? '' : 'selected'}>false</option>
          <option value="true" ${card.isOwned ? 'selected' : ''}>true</option>
        </select>
      </td>
      <td><input data-index="${index}" data-key="set" value="${card.set}" /></td>
      <td><input data-index="${index}" data-key="cardNumber" value="${card.cardNumber}" /></td>
      <td><input data-index="${index}" data-key="comcUrl" value="${card.comcUrl}" /></td>
    `;
    tableBody.appendChild(row);
  });

  const inputs = tableBody.querySelectorAll('input, select');
  inputs.forEach((input) => {
    input.addEventListener('input', (event) => {
      const element = event.target;
      const index = Number(element.dataset.index);
      const key = element.dataset.key;
      const value = ['isYG', 'isOwned'].includes(key) ? element.value === 'true' : element.value;
      cards[index][key] = value;
      setStatus('Unsaved changes.', '');
    });
  });

  downloadFileButton.disabled = cards.length === 0;
}

async function loadCardsFromText(text) {
  cards = parseCardData(JSON.parse(text));
  renderTable();
}

async function openLocalFile() {
  if (!window.showOpenFilePicker) {
    setStatus('Your browser does not support the File System Access API. Use Download JSON copy instead.', 'error');
    return;
  }

  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [{ description: 'JSON files', accept: { 'application/json': ['.json'] } }],
  });

  fileHandle = handle;
  const file = await fileHandle.getFile();
  await loadCardsFromText(await file.text());
  saveFileButton.disabled = false;
  setStatus(`Loaded ${file.name}. Edit and click Save to write changes to disk.`, 'success');
}

async function loadRepoData() {
  const response = await fetch(repoDataPath);
  if (!response.ok) {
    throw new Error(`Failed to load repo data: ${response.status}`);
  }

  await loadCardsFromText(await response.text());
  fileHandle = null;
  saveFileButton.disabled = true;
  setStatus('Loaded repo data. To save in place, use Open local JSON file first.', '');
}

async function saveToOpenedFile() {
  if (!fileHandle) {
    setStatus('No local file is open. Use Open local JSON file first.', 'error');
    return;
  }

  const writable = await fileHandle.createWritable();
  await writable.write(`${JSON.stringify(cards, null, 2)}\n`);
  await writable.close();
  setStatus('Saved changes to local file.', 'success');
}

function downloadJsonCopy() {
  const blob = new Blob([`${JSON.stringify(cards, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = downloadFilename;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus('Downloaded edited JSON copy.', 'success');
}

openFileButton.addEventListener('click', () => {
  openLocalFile().catch((error) => setStatus(error.message, 'error'));
});

loadRepoDataButton.addEventListener('click', () => {
  loadRepoData().catch((error) => setStatus(error.message, 'error'));
});

saveFileButton.addEventListener('click', () => {
  saveToOpenedFile().catch((error) => setStatus(error.message, 'error'));
});

downloadFileButton.addEventListener('click', downloadJsonCopy);
