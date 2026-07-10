/* AnlassBox Admin – Formular-Interaktionen */
(function () {
  'use strict';

  // ---------- Unterartikel-Zeilen hinzufügen / entfernen ----------

  var rowsContainer = document.querySelector('[data-item-rows]');
  var rowTemplate = document.querySelector('[data-item-template]');
  var addRowButton = document.querySelector('[data-add-row]');

  function bindRemove(row) {
    var button = row.querySelector('[data-remove-row]');
    if (!button) return;
    button.addEventListener('click', function () {
      // Letzte Zeile nicht löschen, nur leeren
      if (rowsContainer.querySelectorAll('.item-row').length <= 1) {
        row.querySelectorAll('input').forEach(function (input) { input.value = ''; });
        return;
      }
      row.remove();
    });
  }

  if (rowsContainer && rowTemplate && addRowButton) {
    rowsContainer.querySelectorAll('.item-row').forEach(bindRemove);
    addRowButton.addEventListener('click', function () {
      var fragment = rowTemplate.content.cloneNode(true);
      rowsContainer.appendChild(fragment);
      var newRow = rowsContainer.lastElementChild;
      bindRemove(newRow);
      newRow.querySelector('input').focus();
    });
  }

  // ---------- Slug-Vorschlag aus dem Namen ----------

  var slugSource = document.querySelector('[data-slug-source]');
  var slugTarget = document.querySelector('[data-slug-target]');

  if (slugSource && slugTarget) {
    var slugTouched = slugTarget.value.length > 0;
    slugTarget.addEventListener('input', function () {
      slugTouched = slugTarget.value.length > 0;
    });
    slugSource.addEventListener('input', function () {
      if (slugTouched) return;
      slugTarget.placeholder = slugSource.value
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'wird automatisch erzeugt';
    });
  }
})();
