const $ = (selector) => document.querySelector(selector);
let currentRun = null;
let pollTimer = null;
let viewVersion = 0;
let actionPending = false;

const fieldNames = {
  handle: 'Slug', title: 'H1', seoTitle: 'Meta title', seoDescription: 'Meta description',
  descriptionHtml: 'Descripción y características', shortDescription: 'Descripción corta', faq: 'FAQ',
};
const statusNames = {
  ANALYZING: 'Analizando', ANALYZED: 'Analizado', VALIDATION_FAILED: 'Validación fallida',
  FAILED: 'Fallido', EXECUTING: 'Aplicando cambios', COMPLETED: 'Completado',
  COMPLETED_WITH_ERRORS: 'Completado con errores', ROLLED_BACK: 'Revertido',
  PENDING: 'Pendiente', READY: 'Listo', BLOCKED: 'Bloqueado', NOT_FOUND: 'No encontrado',
  NO_CHANGES: 'Sin cambios', ERROR: 'Error', STALE_DATA: 'Datos modificados',
  UPDATING: 'Actualizando', REQUESTED: 'Solicitado', VERIFIED: 'Verificado',
  VERIFICATION_FAILED: 'Verificación fallida',
};

function escapeHtml(value) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (char) => replacements[char]);
}

function excerpt(value, length = 100) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const characters = Array.from(text);
  return characters.length > length ? `${characters.slice(0, length).join('')}…` : text || '(vacío)';
}

function statusBadge(status) {
  const tone = ['VERIFIED', 'COMPLETED', 'READY'].includes(status) ? 'success'
    : ['ERROR', 'FAILED', 'VERIFICATION_FAILED', 'VALIDATION_FAILED'].includes(status) ? 'error'
    : ['BLOCKED', 'NOT_FOUND', 'STALE_DATA', 'COMPLETED_WITH_ERRORS'].includes(status) ? 'warning' : '';
  return `<span class="badge ${tone}">${escapeHtml(statusNames[status] || status)}</span>`;
}

function message(text = '', error = false) {
  $('#msg').textContent = error ? '' : text;
  $('#error-msg').textContent = error ? text : '';
}

async function jsonResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || `Error HTTP ${response.status}`);
  return data;
}

async function analyze(event) {
  event.preventDefault();
  const file = $('#file').files[0];
  if (!file) { message('Selecciona un archivo XLSX.', true); $('#file').focus(); return; }
  if (!/\.xlsx$/i.test(file.name) || file.size > 25 * 1024 * 1024) {
    message('Selecciona un archivo .xlsx de hasta 25 MB.', true);
    $('#file').focus();
    return;
  }
  if (actionPending || currentRun?.status === 'EXECUTING') return;
  const form = new FormData($('#upload-form'));
  actionPending = true;
  updateControls();
  $('#upload-form').setAttribute('aria-busy', 'true');
  message('Analizando el archivo…');
  try {
    showRun(await jsonResponse(await fetch('/api/runs/analyze', { method: 'POST', body: form })));
    message('Análisis terminado. Revisa los cambios desplegando cada producto.');
  } catch (error) { message(error.message, true); }
  finally {
    actionPending = false;
    $('#upload-form').setAttribute('aria-busy', 'false');
    updateControls();
  }
}

function valueBlock(value, label, key, after = false) {
  return `<div>
    <h3 id="${key}-label" class="value-heading">${label}<span class="muted">${Array.from(String(value ?? '')).length.toLocaleString('es-ES')} caracteres</span></h3>
    <pre class="value-text ${after ? 'value-after' : ''}" tabindex="0" role="region" aria-labelledby="${key}-label" data-focus-key="${key}" data-scroll-key="${key}">${escapeHtml(value ?? '(vacío)')}</pre>
  </div>`;
}

function productRow(product, run) {
  const id = `product-${product.id}`;
  const changes = product.changes || [];
  const errors = product.errors || [];
  const fields = changes.map((change) => fieldNames[change.field] || change.field).join(', ');
  const changeDetails = changes.map((change, index) => {
    const key = `${id}-change-${index}`;
    const name = fieldNames[change.field] || change.field;
    return `<details class="change" data-detail-key="${key}">
      <summary data-focus-key="${key}"><span class="summary-label">${escapeHtml(name)}</span><span class="preview">Propuesto: ${escapeHtml(excerpt(change.after))}</span></summary>
      <div class="comparison">${valueBlock(change.before, 'Actual', `${key}-before`)}${valueBlock(change.after, 'Propuesto', `${key}-after`, true)}</div>
    </details>`;
  }).join('');
  return `<tr class="${product.included ? '' : 'excluded'}">
    <td><label class="checkbox-label"><input type="checkbox" data-include="${product.id}" data-focus-key="${id}-include" ${product.included ? 'checked' : ''} ${run.status !== 'ANALYZED' || actionPending ? 'disabled' : ''}><span class="sr-only">Incluir fila ${product.rowNumber}: ${escapeHtml(excerpt(product.currentHandle, 80))}</span></label></td>
    <th scope="row"><span class="product-title">Fila ${product.rowNumber} · ${escapeHtml(excerpt(product.currentHandle, 85))}</span>
      <details class="product-details" data-detail-key="${id}-identity">
        <summary data-focus-key="${id}-identity">Ver identificación completa</summary>
        <dl><dt>Slug actual</dt><dd>${escapeHtml(product.currentHandle)}</dd>
          <dt>URL actual</dt><dd>${escapeHtml(product.urlActual || '(vacío)')}</dd>
          <dt>ID del producto</dt><dd>${escapeHtml(product.productId || 'No encontrado')}</dd></dl>
      </details>
    </th>
    <td>${statusBadge(product.status)}</td>
    <td>${changes.length ? `<details data-detail-key="${id}-changes"><summary data-focus-key="${id}-changes"><span class="summary-label">${changes.length} ${changes.length === 1 ? 'campo modificado' : 'campos modificados'}</span><span class="preview">${escapeHtml(excerpt(fields, 110))}</span></summary><div class="change-list">${changeDetails}</div></details>` : '<span class="muted">Sin cambios</span>'}</td>
    <td>${errors.length ? `<details class="danger" data-detail-key="${id}-errors"><summary data-focus-key="${id}-errors"><span class="summary-label">${errors.length} ${errors.length === 1 ? 'incidencia' : 'incidencias'}</span><span class="preview">${escapeHtml(excerpt(errors[0], 90))}</span></summary><div class="error-body" tabindex="0" role="region" aria-label="Incidencias de la fila ${product.rowNumber}" data-focus-key="${id}-error-body" data-scroll-key="${id}-error-body"><ul class="error-list">${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></div></details>` : '<span class="muted">Sin incidencias</span>'}</td>
  </tr>`;
}

function render(data) {
  const target = $('#result');
  const sameRun = currentRun?.id === data.id;
  const openDetails = sameRun ? new Set(Array.from(target.querySelectorAll('details[open]'), (node) => node.dataset.detailKey)) : new Set();
  const focusKey = sameRun && target.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  const scrollPositions = sameRun ? Array.from(target.querySelectorAll('[data-scroll-key]'), (node) => [node.dataset.scrollKey, node.scrollTop, node.scrollLeft]) : [];
  currentRun = data;
  const summary = data.summary;
  const metrics = [[summary.total, 'Productos'], [summary.found, 'Encontrados'], [summary.withChanges, 'Con cambios'], [summary.noChanges, 'Sin cambios'], [summary.blocked, 'Bloqueados'], [summary.notFound, 'No encontrados']];
  const validation = data.validationErrors || [];
  target.innerHTML = `<div class="panel result-panel">
    <div class="run-heading"><h2 id="result-title" tabindex="-1" data-focus-key="result-title">Resultado del análisis</h2>${statusBadge(data.status)}</div>
    <details class="run-meta" data-detail-key="run-meta"><summary data-focus-key="run-meta">Tienda ${escapeHtml(data.store_code)} · Ejecución ${escapeHtml(excerpt(data.id, 8))}</summary><p>ID completo: ${escapeHtml(data.id)}</p></details>
    <dl class="metrics">${metrics.map(([count, label]) => `<div><dt>${label}</dt><dd>${count}</dd></div>`).join('')}</dl>
    ${validation.length ? `<details class="notice danger" data-detail-key="validation"><summary data-focus-key="validation">${validation.length} incidencias de validación · ver detalles</summary><div class="error-body" tabindex="0" role="region" aria-label="Incidencias de validación" data-focus-key="validation-body" data-scroll-key="validation-body"><ul class="error-list">${validation.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></div></details>` : ''}
    ${data.rollbackOf ? `<p class="notice">Reversión preparada. Revisa los cambios y pulsa “Aplicar cambios” para confirmarla.</p>` : ''}
    <div class="actions"><a class="button secondary" href="/api/runs/${encodeURIComponent(data.id)}/matrixify" data-focus-key="matrix">Exportar Matrixify</a><button data-action="execute" data-run="${escapeHtml(data.id)}" data-focus-key="execute" disabled>Aplicar cambios</button></div>
    <p id="selection-help" class="help"></p>
    ${data.status === 'EXECUTING' ? `<p class="notice">Aplicando cambios · ${summary.verified} productos verificados.</p>` : ''}
  </div>
  <p id="table-help" class="table-help">Despliega los campos para comparar el texto completo. La tabla se puede desplazar con las flechas al recibir el foco.</p>
  <div class="table-scroll" role="region" aria-label="Productos y cambios SEO" aria-describedby="table-help" tabindex="0" data-focus-key="table" data-scroll-key="table">
    <table><caption>Productos del archivo · ${summary.total} filas</caption><colgroup><col class="include-column"><col class="product-column"><col class="status-column"><col><col class="error-column"></colgroup>
      <thead><tr><th scope="col">Incluir</th><th scope="col">Fila / Identificación</th><th scope="col">Estado</th><th scope="col">Cambios</th><th scope="col">Incidencias</th></tr></thead>
      <tbody>${(data.products || []).map((product) => productRow(product, data)).join('') || '<tr><td colspan="5" class="empty-state">No hay productos en este análisis.</td></tr>'}</tbody>
    </table>
  </div>`;
  target.querySelectorAll('details').forEach((node) => { node.open = openDetails.has(node.dataset.detailKey); });
  updateControls();
  if (focusKey) {
    const control = Array.from(target.querySelectorAll('[data-focus-key]')).find((node) => node.dataset.focusKey === focusKey);
    if (control && !control.disabled) control.focus({ preventScroll: true });
  }
  const scrollers = new Map(Array.from(target.querySelectorAll('[data-scroll-key]'), (node) => [node.dataset.scrollKey, node]));
  scrollPositions.forEach(([key, top, left]) => {
    const node = scrollers.get(key);
    if (node) { node.scrollTop = top; node.scrollLeft = left; }
  });
}

function updateControls() {
  const executing = currentRun?.status === 'EXECUTING';
  $('#analyze').disabled = actionPending || executing || !$('#store').options.length;
  $('#store').disabled = actionPending || executing;
  $('#file').disabled = actionPending || executing;
  const selected = (currentRun?.products || []).filter((product) => product.status === 'READY' && product.included).length;
  const execute = $('[data-action="execute"]');
  if (execute) {
    execute.disabled = actionPending || currentRun.status !== 'ANALYZED' || !selected;
    execute.setAttribute('aria-describedby', 'selection-help');
    $('#selection-help').textContent = currentRun.status === 'ANALYZED'
      ? `${selected} productos listos e incluidos para aplicar.`
      : executing ? 'La ejecución está en curso. Puedes consultar los detalles de cada producto.'
        : 'Los cambios solo se pueden aplicar desde un análisis válido pendiente de ejecución.';
  }
  document.querySelectorAll('[data-include]').forEach((node) => {
    node.disabled = actionPending || currentRun?.status !== 'ANALYZED';
  });
  document.querySelectorAll('button[data-action="open"], button[data-action="rollback"]').forEach((node) => {
    node.disabled = actionPending;
  });
}

async function loadHistory() {
  const target = $('#history');
  target.setAttribute('aria-busy', 'true');
  try {
    const runs = await jsonResponse(await fetch('/api/runs'));
    const focused = target.contains(document.activeElement) ? {
      action: document.activeElement.dataset.action, run: document.activeElement.dataset.run,
    } : null;
    target.innerHTML = runs.length ? `<ul class="history-list">${runs.map((run) => {
      const date = new Date(run.created_at);
      const formatted = Number.isNaN(date.getTime()) ? run.created_at : date.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
      const rollback = ['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(run.status)
        ? `<button class="secondary" data-action="rollback" data-run="${escapeHtml(run.id)}" aria-label="Preparar reversión de la ejecución ${escapeHtml(run.id)}">Revertir</button>` : '';
      return `<li class="history-entry"><div><time class="history-date" datetime="${escapeHtml(run.created_at)}">${escapeHtml(formatted)}</time><p class="muted">Tienda ${escapeHtml(run.store_code)} · ${run.total_rows} filas</p></div><div class="history-info">${statusBadge(run.status)}</div><div class="history-actions"><button class="link" data-action="open" data-run="${escapeHtml(run.id)}" aria-label="Abrir ejecución ${escapeHtml(run.id)}">Ver ${escapeHtml(excerpt(run.id, 8))}</button>${rollback}</div></li>`;
    }).join('')}</ul>` : '<p class="muted">Todavía no hay ejecuciones.</p>';
    updateControls();
    if (focused) {
      const control = Array.from(target.querySelectorAll('button')).find((node) => node.dataset.action === focused.action && node.dataset.run === focused.run);
      if (control && !control.disabled) control.focus({ preventScroll: true });
    }
  } catch (error) {
    target.textContent = `No se pudo cargar el histórico: ${error.message}`;
    message(`No se pudo cargar el histórico: ${error.message}`, true);
  } finally { target.setAttribute('aria-busy', 'false'); }
}

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
  viewVersion += 1;
}

function showRun(data) {
  stopPolling();
  render(data);
  $('#result-title').focus();
  loadHistory();
  if (data.status === 'EXECUTING') schedulePoll(data.id, viewVersion);
}

function schedulePoll(id, version) {
  pollTimer = setTimeout(async () => {
    try {
      const data = await jsonResponse(await fetch(`/api/runs/${encodeURIComponent(id)}`));
      if (version !== viewVersion) return;
      const previousVerified = currentRun?.summary.verified;
      // Keep the DOM in place while the server reports no changes, so reading is uninterrupted.
      if (JSON.stringify(data) !== JSON.stringify(currentRun)) render(data);
      if (data.status === 'EXECUTING') {
        if (data.summary.verified !== previousVerified) message(`Aplicando cambios: ${data.summary.verified} productos verificados.`);
        schedulePoll(id, version);
      } else {
        message(`Ejecución terminada: ${statusNames[data.status] || data.status}.`);
        loadHistory();
      }
    } catch (error) {
      if (version !== viewVersion) return;
      message(`No se pudo consultar el progreso: ${error.message}. Se volverá a intentar.`, true);
      schedulePoll(id, version);
    }
  }, 2000);
}

async function openRun(id) {
  if (actionPending) return;
  actionPending = true;
  updateControls();
  $('#result').setAttribute('aria-busy', 'true');
  stopPolling();
  message('Cargando ejecución…');
  try {
    showRun(await jsonResponse(await fetch(`/api/runs/${encodeURIComponent(id)}`)));
    message('Ejecución cargada.');
  } catch (error) {
    message(error.message, true);
    if (currentRun?.status === 'EXECUTING') schedulePoll(currentRun.id, viewVersion);
  } finally {
    actionPending = false;
    $('#result').setAttribute('aria-busy', 'false');
    updateControls();
  }
}

async function executeRun(id) {
  if (actionPending || !confirm('¿Aplicar los cambios aprobados?')) return;
  actionPending = true;
  updateControls();
  try {
    await jsonResponse(await fetch(`/api/runs/${encodeURIComponent(id)}/execute`, { method: 'POST' }));
    stopPolling();
    render({ ...currentRun, status: 'EXECUTING' });
    $('#result-title').focus({ preventScroll: true });
    message('Aplicando cambios…');
    schedulePoll(id, viewVersion);
  } catch (error) { message(error.message, true); }
  finally { actionPending = false; updateControls(); }
}

async function rollbackRun(id) {
  if (actionPending || !confirm('Se creará una nueva ejecución para restaurar los valores anteriores. ¿Continuar?')) return;
  actionPending = true;
  updateControls();
  stopPolling();
  message('Preparando reversión…');
  try {
    showRun(await jsonResponse(await fetch(`/api/runs/${encodeURIComponent(id)}/rollback`, { method: 'POST' })));
    message('Reversión preparada. Revisa los cambios antes de aplicarlos.');
  } catch (error) {
    message(error.message, true);
    if (currentRun?.status === 'EXECUTING') schedulePoll(currentRun.id, viewVersion);
  } finally { actionPending = false; updateControls(); }
}

$('#upload-form').addEventListener('submit', analyze);
$('#result').addEventListener('change', async (event) => {
  const checkbox = event.target.closest('[data-include]');
  if (!checkbox || actionPending) return;
  const product = currentRun.products.find((item) => String(item.id) === checkbox.dataset.include);
  if (!product) return;
  const included = checkbox.checked;
  actionPending = true;
  updateControls();
  try {
    await jsonResponse(await fetch(`/api/products/${checkbox.dataset.include}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ included }),
    }));
    product.included = included;
    checkbox.closest('tr').classList.toggle('excluded', !included);
    message(`Fila ${product.rowNumber} ${included ? 'incluida' : 'excluida'}.`);
  } catch (error) { message(error.message, true); checkbox.checked = product.included; }
  finally {
    actionPending = false;
    updateControls();
    checkbox.focus({ preventScroll: true });
  }
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const { action, run } = button.dataset;
  if (action === 'execute') executeRun(run);
  if (action === 'rollback') rollbackRun(run);
  if (action === 'open') openRun(run);
});

if (!$('#store').options.length) message('No hay tiendas configuradas en el servidor.', true);
updateControls();
loadHistory();
