/* AnlassBox – Warenkorb & Seiten-Interaktionen (ohne Abhängigkeiten) */
(function () {
  'use strict';

  var STORAGE_KEY = 'anlassbox_cart';

  // Statische Präsentations-Version (GitHub Pages): kein Server, kein echter Checkout.
  // window.ANLASSBOX_STATIC wird dort auf den Basispfad gesetzt (z. B. "/anlassbox-shop"),
  // beim laufenden Server ist es undefiniert und alles verhält sich wie gewohnt.
  var STATIC_BASE = window.ANLASSBOX_STATIC || null;
  var BASE = STATIC_BASE || '';

  // ---------- Warenkorb-Speicher (localStorage) ----------

  function readCart() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter(function (entry) {
        return entry && typeof entry.slug === 'string' && Number(entry.qty) >= 1;
      }).map(function (entry) {
        return { slug: entry.slug, qty: Math.min(99, Math.floor(Number(entry.qty))) };
      });
    } catch (e) {
      return [];
    }
  }

  function writeCart(cart) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    updateBadge();
  }

  function addToCart(slug, qty) {
    var cart = readCart();
    var existing = cart.find(function (e) { return e.slug === slug; });
    if (existing) {
      existing.qty = Math.min(99, existing.qty + qty);
    } else {
      cart.push({ slug: slug, qty: qty });
    }
    writeCart(cart);
  }

  function setQty(slug, qty) {
    var cart = readCart();
    var entry = cart.find(function (e) { return e.slug === slug; });
    if (!entry) return;
    if (qty < 1) {
      cart = cart.filter(function (e) { return e.slug !== slug; });
    } else {
      entry.qty = Math.min(99, qty);
    }
    writeCart(cart);
  }

  function removeFromCart(slug) {
    writeCart(readCart().filter(function (e) { return e.slug !== slug; }));
  }

  function cartCount() {
    return readCart().reduce(function (sum, e) { return sum + e.qty; }, 0);
  }

  // ---------- Kopfzeilen-Zähler ----------

  function updateBadge() {
    var badge = document.querySelector('[data-cart-count]');
    if (!badge) return;
    var count = cartCount();
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  // ---------- Toast ----------

  var toastTimer = null;
  function showToast(message, withCartLink) {
    var toast = document.querySelector('[data-toast]');
    if (!toast) return;
    toast.innerHTML = '';
    toast.appendChild(document.createTextNode(message));
    if (withCartLink) {
      var link = document.createElement('a');
      link.href = '/warenkorb';
      link.textContent = 'Zum Warenkorb';
      toast.appendChild(link);
    }
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 4000);
  }

  // ---------- Mengen-Stepper (Detailseite) ----------

  function bindStepper(stepper, onChange) {
    var input = stepper.querySelector('input');
    function clamp(v) { return Math.max(1, Math.min(99, Math.floor(v) || 1)); }
    stepper.querySelector('[data-qty-minus]').addEventListener('click', function () {
      input.value = clamp(Number(input.value) - 1);
      if (onChange) onChange(Number(input.value));
    });
    stepper.querySelector('[data-qty-plus]').addEventListener('click', function () {
      input.value = clamp(Number(input.value) + 1);
      if (onChange) onChange(Number(input.value));
    });
    input.addEventListener('change', function () {
      input.value = clamp(Number(input.value));
      if (onChange) onChange(Number(input.value));
    });
  }

  var detailStepper = document.querySelector('.buy-row [data-qty]');
  if (detailStepper) bindStepper(detailStepper, null);

  // ---------- "In den Warenkorb" ----------

  var addButton = document.querySelector('[data-add-to-cart]');
  if (addButton) {
    addButton.addEventListener('click', function () {
      var qtyInput = detailStepper ? detailStepper.querySelector('input') : null;
      var qty = qtyInput ? Math.max(1, Math.min(99, Number(qtyInput.value) || 1)) : 1;
      addToCart(addButton.getAttribute('data-slug'), qty);
      showToast('In den Warenkorb gelegt ✓', true);
    });
  }

  // ---------- Bildergalerie (Detailseite) ----------

  var mainImage = document.getElementById('gallery-main-img');
  if (mainImage) {
    document.querySelectorAll('[data-gallery-src]').forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        mainImage.src = thumb.getAttribute('data-gallery-src');
        document.querySelectorAll('.gallery-thumb').forEach(function (t) {
          t.classList.toggle('is-active', t === thumb);
        });
      });
    });
  }

  // ---------- Erfolgsseite: Warenkorb leeren ----------
  // Nur bei echtem Bestellabschluss (Bestellung existiert), nicht bei bloßem Aufruf.

  var successBox = document.getElementById('order-success');
  if (successBox && successBox.hasAttribute('data-order-complete')) {
    localStorage.removeItem(STORAGE_KEY);
  }

  // ---------- Warenkorb-Seite ----------

  var cartRoot = document.getElementById('cart-root');
  if (cartRoot) {
    var shippingCents = Number(cartRoot.getAttribute('data-shipping')) || 0;
    var freeFromCents = Number(cartRoot.getAttribute('data-free-from')) || 0;
    var listEl = cartRoot.querySelector('[data-cart-list]');
    var emptyEl = cartRoot.querySelector('[data-cart-empty]');
    var summaryEl = cartRoot.querySelector('[data-cart-summary]');
    var productsBySlug = {};

    var euro = function (cents) {
      return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    };

    var renderCart = function () {
      var cart = readCart().filter(function (e) { return productsBySlug[e.slug]; });
      listEl.innerHTML = '';

      if (cart.length === 0) {
        emptyEl.hidden = false;
        summaryEl.hidden = true;
        return;
      }
      emptyEl.hidden = true;
      summaryEl.hidden = false;

      var subtotal = 0;

      cart.forEach(function (entry) {
        var product = productsBySlug[entry.slug];
        var lineTotal = product.price_cents * entry.qty;
        subtotal += lineTotal;

        var li = document.createElement('li');
        li.className = 'cart-item';

        var img = document.createElement('img');
        img.src = product.image;
        img.alt = product.name;
        li.appendChild(img);

        var info = document.createElement('div');
        var nameLink = document.createElement('a');
        nameLink.className = 'cart-item-name';
        nameLink.href = BASE + '/box/' + encodeURIComponent(product.slug) + (STATIC_BASE ? '/' : '');
        nameLink.textContent = product.name;
        info.appendChild(nameLink);

        var price = document.createElement('div');
        price.className = 'cart-item-price';
        price.textContent = euro(product.price_cents) + ' / Box';
        info.appendChild(price);

        var stepper = document.createElement('div');
        stepper.className = 'qty-stepper';
        stepper.setAttribute('data-qty', '');
        stepper.innerHTML =
          '<button type="button" data-qty-minus aria-label="Menge verringern">−</button>' +
          '<input type="number" min="1" max="99" aria-label="Menge">' +
          '<button type="button" data-qty-plus aria-label="Menge erhöhen">+</button>';
        stepper.querySelector('input').value = entry.qty;
        info.appendChild(stepper);
        li.appendChild(info);

        var actions = document.createElement('div');
        actions.className = 'cart-item-actions';
        var total = document.createElement('span');
        total.className = 'cart-item-total';
        total.textContent = euro(lineTotal);
        actions.appendChild(total);
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'cart-remove';
        remove.textContent = 'Entfernen';
        remove.addEventListener('click', function () {
          removeFromCart(entry.slug);
          renderCart();
        });
        actions.appendChild(remove);
        li.appendChild(actions);

        bindStepper(stepper, function (qty) {
          setQty(entry.slug, qty);
          renderCart();
        });

        listEl.appendChild(li);
      });

      var shipping = (freeFromCents > 0 && subtotal >= freeFromCents) ? 0 : shippingCents;
      summaryEl.querySelector('[data-sum-subtotal]').textContent = euro(subtotal);
      summaryEl.querySelector('[data-sum-shipping]').textContent =
        shipping === 0 ? 'kostenlos' : euro(shipping);
      summaryEl.querySelector('[data-sum-total]').textContent = euro(subtotal + shipping);

      var hint = summaryEl.querySelector('[data-free-shipping-hint]');
      if (hint) {
        if (freeFromCents > 0 && subtotal < freeFromCents) {
          hint.textContent = 'Nur noch ' + euro(freeFromCents - subtotal) + ' bis zum kostenlosen Versand!';
          hint.hidden = false;
        } else {
          hint.hidden = true;
        }
      }
    };

    // Produktdaten (Preise!) laden – vom Server oder aus der statischen JSON-Datei
    fetch(STATIC_BASE ? BASE + '/api/products.json' : '/api/products')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        data.products.forEach(function (p) { productsBySlug[p.slug] = p; });
        // Boxen entfernen, die es nicht mehr gibt
        var cleaned = readCart().filter(function (e) { return productsBySlug[e.slug]; });
        writeCart(cleaned);
        renderCart();
      })
      .catch(function () {
        emptyEl.hidden = false;
        emptyEl.querySelector('p').textContent =
          'Der Warenkorb konnte nicht geladen werden. Bitte Seite neu laden.';
      });

    // ---------- Zur Kasse ----------

    var checkoutButton = cartRoot.querySelector('[data-checkout]');
    var errorEl = cartRoot.querySelector('[data-checkout-error]');
    if (checkoutButton) {
      checkoutButton.addEventListener('click', function () {
        var cart = readCart();
        if (cart.length === 0) return;

        // Präsentations-Modus: keine echte Zahlung, nur ein freundlicher Hinweis.
        if (STATIC_BASE) {
          errorEl.classList.add('is-note');
          errorEl.textContent = 'Dies ist eine Vorschau – im fertigen Shop startet hier die sichere Bezahlung. Du kannst weiter stöbern und Boxen in den Warenkorb legen.';
          errorEl.hidden = false;
          showToast('Vorschau – hier startet später die Bezahlung', false);
          return;
        }

        checkoutButton.disabled = true;
        checkoutButton.textContent = 'Einen Moment …';
        errorEl.hidden = true;

        fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: cart }),
        })
          .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
          .then(function (result) {
            if (result.ok && result.data.url) {
              window.location.href = result.data.url;
            } else {
              throw new Error(result.data.error || 'Unbekannter Fehler');
            }
          })
          .catch(function (err) {
            errorEl.textContent = err.message || 'Die Kasse ist gerade nicht erreichbar.';
            errorEl.hidden = false;
            checkoutButton.disabled = false;
            checkoutButton.textContent = 'Zur Kasse';
          });
      });
    }
  }

  updateBadge();
})();
