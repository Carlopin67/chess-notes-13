// ============================================================
// ICONOS PROPIOS — controles e interfaz
// Todo vectorial, ningún emoji ni carácter de teclado. Trazo
// redondeado y grosor regular, en la línea de los símbolos de iOS.
// ============================================================

function strokeIcon(paths, width = 1.8) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" ` +
         `stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

function fillIcon(paths) {
  return `<svg viewBox="0 0 24 24" fill="currentColor">${paths}</svg>`;
}

const ICONS = {
  prev: fillIcon('<path d="M16.6 5.3v13.4a1.1 1.1 0 0 1-1.7.9L5.7 12.9a1.1 1.1 0 0 1 0-1.8l9.2-6.7a1.1 1.1 0 0 1 1.7.9z"/>'),
  next: fillIcon('<path d="M7.4 5.3v13.4a1.1 1.1 0 0 0 1.7.9l9.2-6.7a1.1 1.1 0 0 0 0-1.8L9.1 4.4a1.1 1.1 0 0 0-1.7.9z"/>'),
  start: fillIcon('<rect x="4.4" y="5" width="2.7" height="14" rx="1.35"/>' +
    '<path d="M19.4 5.8v12.4a1.1 1.1 0 0 1-1.7.9l-8.6-6.2a1.1 1.1 0 0 1 0-1.8l8.6-6.2a1.1 1.1 0 0 1 1.7.9z"/>'),

  back: strokeIcon('<path d="M15 4.5 7.5 12l7.5 7.5"/>', 2.4),
  add: strokeIcon('<path d="M12 5v14M5 12h14"/>', 2.2),
  close: strokeIcon('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', 2.2),

  trash: strokeIcon('<path d="M4.5 6.5h15M9.5 6.5V4.9a1.1 1.1 0 0 1 1.1-1.1h2.8a1.1 1.1 0 0 1 1.1 1.1v1.6"/>' +
    '<path d="M6.5 6.5l.9 12.2a1.8 1.8 0 0 0 1.8 1.6h5.6a1.8 1.8 0 0 0 1.8-1.6l.9-12.2M10 10.5v6M14 10.5v6"/>', 1.9),

  settings: strokeIcon('<path d="M4 7.5h4.3M13.7 7.5H20M4 16.5h9.3M18.7 16.5H20"/>' +
    '<circle cx="11" cy="7.5" r="2.6"/><circle cx="16" cy="16.5" r="2.6"/>'),

  contrast: strokeIcon('<circle cx="12" cy="12" r="8.5"/>' +
    '<path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none"/>'),

  branch: strokeIcon('<circle cx="7" cy="5.6" r="2.3"/><circle cx="7" cy="18.4" r="2.3"/>' +
    '<circle cx="17" cy="5.6" r="2.3"/><path d="M7 7.9v8.2M17 7.9v1.4a4.2 4.2 0 0 1-4.2 4.2H9.5"/>', 1.9),

  teacher: strokeIcon('<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/>' +
    '<path d="M6.5 11v4.3c0 1.6 2.5 3.2 5.5 3.2s5.5-1.6 5.5-3.2V11M21.5 9v5"/>', 1.9),

  pencil: strokeIcon('<path d="M4.5 19.5l1-4.2L15.8 5a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.7 18.5z"/>' +
    '<path d="M14 6.8l3.2 3.2"/>', 1.9),

  flip: strokeIcon('<path d="M8 19.5V4.5M4.5 8 8 4.5 11.5 8M16 4.5v15M12.5 16l3.5 3.5 3.5-3.5"/>'),

  coords: strokeIcon('<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="3"/>' +
    '<path d="M3.8 9.3h16.4M3.8 14.7h16.4M9.3 3.8v16.4M14.7 3.8v16.4" stroke-width="1.3"/>', 1.9),

  awake: strokeIcon('<circle cx="12" cy="12" r="3.8"/>' +
    '<path d="M12 2.8v2.2M12 19v2.2M21.2 12H19M5 12H2.8M18.5 5.5 17 7M7 17l-1.5 1.5M18.5 18.5 17 17M7 7 5.5 5.5"/>', 1.9),

  piece: strokeIcon('<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.6" ry="8.5"/>' +
    '<path d="M3.5 12h17"/>', 1.8),

  more: fillIcon('<circle cx="5.5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18.5" cy="12" r="1.9"/>'),

  search: strokeIcon('<circle cx="10.5" cy="10.5" r="6.3"/><path d="M15.3 15.3 20 20"/>', 2.2),

  chevron: strokeIcon('<path d="M9 5l7 7-7 7"/>', 2.3),

  textSize: strokeIcon('<path d="M2.5 18 6.4 8l3.9 10M4 14.6h4.8"/>' +
    '<path d="M13 18.4 17.5 5.6 22 18.4M14.7 14.4h5.6" stroke-width="2.2"/>', 1.9),

  sync: strokeIcon('<path d="M19.6 9.2A8 8 0 0 0 5.4 7.2M4.4 14.8a8 8 0 0 0 14.2 2"/>' +
    '<path d="M19.8 4.6v4.8H15M4.2 19.4v-4.8H9"/>', 1.9),

  key: strokeIcon('<circle cx="8" cy="15.5" r="3.9"/><path d="M10.8 12.7 19 4.5M16.2 7.3l2.3 2.3M13.9 9.6l1.8 1.8"/>', 1.9),

  link: strokeIcon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.2 1.2"/>' +
    '<path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>', 1.9),

  share: strokeIcon('<path d="M12 14.5v-11M8 7.3l4-3.8 4 3.8"/>' +
    '<path d="M8.5 10H7a2 2 0 0 0-2 2v6.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V12a2 2 0 0 0-2-2h-1.5"/>'),

  knight: strokeIcon('<path d="M6.5 20h11M8.2 20l.7-3.6c-1.9-1.3-2.6-3.3-2-5.6L8.4 6.2 10.6 4l1.5 1.4c3.7.5 6 3.6 6 7.8V20"/>' +
    '<path d="M8.6 12.6l3.4-1.4"/><circle cx="11.6" cy="8.3" r="0.9" fill="currentColor" stroke="none"/>', 1.8),

  evalBar: strokeIcon('<rect x="3" y="8" width="18" height="8" rx="2.5"/>' +
    '<path d="M5.5 10.5h6v3h-6z" fill="currentColor" stroke="none"/><path d="M12 5.5v13" stroke-width="1.6"/>', 1.9),

  drop: strokeIcon('<path d="M12 3.5c3 4 6 7.3 6 10.6a6 6 0 0 1-12 0c0-3.3 3-6.6 6-10.6z"/>' +
    '<path d="M9.2 14.6a3 3 0 0 0 2.4 2.6" stroke-width="1.6"/>', 1.9)
};

function iconButton(name) { return ICONS[name] || ''; }
