// Día Uno: mejoras progresivas. Todo funciona sin JavaScript.
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  // Menú en pantallas pequeñas
  const toggle = document.querySelector('[data-nav-toggle]');
  const nav = document.getElementById('menu');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Lleva el foco al resumen de errores
  const summary = document.querySelector('[data-autofocus]');
  if (summary) summary.focus();

  // Confirmación de acciones irreversibles
  document.addEventListener('submit', function (e) {
    const form = e.target;
    const msg = form.getAttribute && form.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // «No lo sé» desactiva los campos de la pregunta
  const unknown = document.querySelector('[data-unknown]');
  if (unknown) {
    const body = unknown.closest('form');
    const sync = function () {
      body.querySelectorAll('.q-body input:not([data-unknown]):not([type=hidden]), .q-body select, .q-body textarea').forEach(function (el) {
        el.disabled = unknown.checked;
      });
    };
    unknown.addEventListener('change', sync);
    sync();
  }

  // Opción exclusiva en preguntas de varias respuestas («Ninguna»)
  document.querySelectorAll('.options input[type=checkbox]').forEach(function (box) {
    box.addEventListener('change', function () {
      if (!box.checked) return;
      const all = box.closest('.options').querySelectorAll('input[type=checkbox]');
      const exclusive = ['ninguno'];
      all.forEach(function (other) {
        if (other === box) return;
        if (exclusive.includes(box.value) || exclusive.includes(other.value)) other.checked = false;
      });
    });
  });

  // Coach: sugerencias y envío con Enter
  const chatForm = document.querySelector('[data-chat]');
  if (chatForm) {
    const ta = chatForm.querySelector('textarea');
    document.querySelectorAll('[data-suggest]').forEach(function (b) {
      b.addEventListener('click', function () {
        ta.value = b.getAttribute('data-suggest');
        ta.focus();
      });
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (ta.value.trim()) chatForm.requestSubmit();
      }
    });
    chatForm.addEventListener('submit', function () {
      const btn = chatForm.querySelector('button[type=submit]');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Pensando…';
      }
    });
    const chat = document.getElementById('chat');
    if (chat && chat.lastElementChild) chat.lastElementChild.scrollIntoView({ block: 'end' });
  }
})();
