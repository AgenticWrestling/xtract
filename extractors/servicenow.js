// ServiceNow list-view extractor for xtract
// Walks every page of a sys_dictionary_list.do (or any classic list) table
// via the built-in "Next page" VCR control and exports all rows as JSON.

window.xtractExtractors = window.xtractExtractors || {};
window.xtractPaginators = window.xtractPaginators || {};

function snTableInfo() {
  const table = document.querySelector('table.list_table[data-list_id]');
  if (!table) return null;

  const listId = table.getAttribute('data-list_id');
  const headerRow = table.querySelector(`thead tr[id="hdr_${listId}"]`) || table.querySelector('thead tr');
  if (!headerRow) return null;

  const fieldCols = [];
  Array.from(headerRow.children).forEach((th, idx) => {
    const name = th.getAttribute('name');
    if (name && name !== 'search') {
      fieldCols.push({
        index: idx,
        field: name,
        label: th.getAttribute('glide_label') || th.textContent.trim()
      });
    }
  });

  return { table, listId, fieldCols };
}

function snExtractRows(table, fieldCols) {
  const rows = [];
  const trs = table.querySelectorAll('tbody tr[id^="row_"]');
  trs.forEach(tr => {
    const cells = Array.from(tr.children);
    const record = { sys_id: tr.getAttribute('sys_id') || '' };
    fieldCols.forEach(({ index, field }) => {
      const cell = cells[index];
      record[field] = cell ? cell.textContent.replace(/\s+/g, ' ').trim() : '';
    });
    rows.push(record);
  });
  return rows;
}

function snFindNextButton() {
  const buttons = Array.from(document.querySelectorAll('button[name="vcr_next"]'));
  return buttons.find(b => !b.disabled && !b.classList.contains('tab_button_disabled')) || null;
}

async function snWaitForPageChange(prevFirstSysId, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = snTableInfo();
    if (info) {
      const firstRow = info.table.querySelector('tbody tr[id^="row_"]');
      const sysId = firstRow ? firstRow.getAttribute('sys_id') : null;
      if (sysId && sysId !== prevFirstSysId) return true;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

// Single-shot extraction (used by the regular "extract current view" path)
window.xtractExtractors['service-now.com'] = function extractServiceNowTable() {
  const info = snTableInfo();
  if (!info) return null;

  const rows = snExtractRows(info.table, info.fieldCols);
  const payload = {
    table: info.listId,
    columns: info.fieldCols.map(c => c.field),
    rows
  };
  return '```json\n' + JSON.stringify(payload, null, 2) + '\n```';
};

// Full pagination walk (used by the "extract all pages" path)
window.xtractPaginators['service-now.com'] = async function paginateServiceNowTable(onProgress) {
  const info = snTableInfo();
  if (!info) return null;

  const allRows = [];
  const seen = new Set();
  let pageNum = 1;

  while (true) {
    const currentInfo = snTableInfo();
    if (!currentInfo) break;

    const rows = snExtractRows(currentInfo.table, currentInfo.fieldCols);
    rows.forEach(r => {
      if (r.sys_id && !seen.has(r.sys_id)) {
        seen.add(r.sys_id);
        allRows.push(r);
      }
    });

    if (onProgress) onProgress(allRows.length, pageNum);

    const firstRow = currentInfo.table.querySelector('tbody tr[id^="row_"]');
    const prevFirstSysId = firstRow ? firstRow.getAttribute('sys_id') : null;

    const nextBtn = snFindNextButton();
    if (!nextBtn) break;

    nextBtn.click();
    pageNum++;

    const changed = await snWaitForPageChange(prevFirstSysId);
    if (!changed) break;

    await new Promise(r => setTimeout(r, 150));
  }

  return {
    table: info.listId,
    columns: info.fieldCols.map(c => c.field),
    totalRows: allRows.length,
    rows: allRows
  };
};
