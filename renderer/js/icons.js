const ICONS = {
  dashboard:
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  receipt:
    '<path d="M6 3.5h12v17l-3-1.9-3 1.9-3-1.9-3 1.9z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  invoices:
    '<path d="M8 3.5h9a2 2 0 0 1 2 2V17"/><path d="M5 6.5h10a2 2 0 0 1 2 2v12l-2.8-1.7-2.7 1.7-2.7-1.7L6 20.5v-12a2 2 0 0 1 2-2z" transform="translate(-1.5 0)"/><path d="M8 10h5M8 13.5h5"/>',
  products:
    '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.4"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.4"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.4"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.4"/>',
  customers:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.4 20a5.7 5.7 0 0 1 11.2 0"/><path d="M16 5.4a3 3 0 0 1 0 5.4"/><path d="M17.4 14.2a5.4 5.4 0 0 1 3.2 4.8"/>',
  stock:
    '<path d="M12 3.2 20 7.5v9L12 20.8 4 16.5v-9z"/><path d="M4 7.5l8 4.3 8-4.3"/><path d="M12 11.8v9"/><path d="M8 5.4l8 4.3"/>',
  reports:
    '<path d="M4 20V11"/><path d="M10 20V4"/><path d="M16 20v-6"/><path d="M22 20H2"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.3"/><path d="m15.3 15.3 4.4 4.4"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16 9.2"/>',
  alert: '<path d="M12 3.5 21 19.5H3z"/><path d="M12 9v4.5"/><circle cx="12" cy="16.6" r=".6" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.4"/><circle cx="12" cy="7.8" r=".65" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.7h5V7"/><path d="M6.5 7l.8 12.3h9.4L17.5 7"/><path d="M10 10.5v5.5M14 10.5v5.5"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 6.5 3 3"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/><path d="M5 9v9.5a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18.5V9"/><path d="M10 13h4"/>',
  restore: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v5.5H9"/>',
  printer: '<path d="M6.5 9V3.5h11V9"/><path d="M6.5 17H4a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 4 9h16a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 20 17h-2.5"/><rect x="6.5" y="14" width="11" height="6.5" rx="1"/>',
  download: '<path d="M12 3.5v11"/><path d="m7.5 11 4.5 4.5L16.5 11"/><path d="M4 19.5h16"/>',
  upload: '<path d="M12 16.5v-12"/><path d="m7.5 9 4.5-4.5L16.5 9"/><path d="M4 20.5h16"/>',
  database:
    '<ellipse cx="12" cy="5.6" rx="7.5" ry="2.9"/><path d="M4.5 5.6v6.2c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9V5.6"/><path d="M4.5 11.8v6.3c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9v-6.3"/>',
  folder:
    '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  shield: '<path d="M12 3 19 6v5.5c0 4.6-2.8 7.9-7 9.5-4.2-1.6-7-4.9-7-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.4-4.6"/>',
  calendar:
    '<rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3.5v4M16 3.5v4"/>',
  phone:
    '<path d="M7.3 3.7 9.5 8 7.6 9.9a14.2 14.2 0 0 0 6.5 6.5l1.9-1.9 4.3 2.2-.7 3.1a2 2 0 0 1-2 1.5C10.2 20.5 3.5 13.8 2.7 6.4a2 2 0 0 1 1.5-2z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  mapPin: '<path d="M12 21s7-5.8 7-11.3A7 7 0 0 0 5 9.7C5 15.2 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.6"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 9.5h19"/><path d="M6.5 14.5h4"/>',
  bank: '<path d="M3.5 9.5 12 4l8.5 5.5"/><path d="M5.5 10.5v8M10 10.5v8M14 10.5v8M18.5 10.5v8"/><path d="M3 20.5h18"/>',
  wallet: '<path d="M4 6.5A1.5 1.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M4 8.5h16"/><path d="M15 13h5v4h-5a2 2 0 0 1 0-4z"/>',
  fileText: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5"/><path d="M9 12h6M9 15.5h6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.3l3.2 2"/>',
  trendingUp: '<path d="m3.5 16.5 6-6 4 4 7-7"/><path d="M15 7.5h5.5V13"/>',
  coins:
    '<ellipse cx="9" cy="7" rx="5.5" ry="3"/><path d="M3.5 7v4c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3V7"/><path d="M9 14v3c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-6c0-1.7-2.5-3-5.5-3"/>',
  userPlus:
    '<circle cx="9.5" cy="8" r="3.3"/><path d="M3.5 20a6 6 0 0 1 12 0"/><path d="M18.5 8.5v6M15.5 11.5h6"/>',
  filter: '<path d="M3.5 5.5h17l-6.7 8v5.3l-3.6 1.7V13.5z"/>',
  more: '<circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5.5H15"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  boxDown: '<path d="M12 3.5v10"/><path d="m8 9.5 4 4 4-4"/><path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  sparkle:
    '<path d="M12 3.5c.5 4.4 2.1 6 6.5 6.5-4.4.5-6 2.1-6.5 6.5-.5-4.4-2.1-6-6.5-6.5 4.4-.5 6-2.1 6.5-6.5z"/><path d="M18 16.5c.2 1.8.9 2.5 2.7 2.7-1.8.2-2.5.9-2.7 2.7-.2-1.8-.9-2.5-2.7-2.7 1.8-.2 2.5-.9 2.7-2.7z"/>',
  arrowUpRight: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  building:
    '<path d="M4 20.5V4.5h9v16"/><path d="M13 9h7v11.5"/><path d="M7.5 8h2M7.5 11.5h2M7.5 15h2M16 12.5h1M16 16h1"/>',
  note: '<path d="M5 3.5h14v17H5z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>'
};

export function icon(name, className = '') {
  const paths = ICONS[name] ?? ICONS.info;
  const classes = `icon${className ? ` ${className}` : ''}`.trim();
  return `<svg class="${classes}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export function brandMark(className = '') {
  const classes = className ? ` class="${className}"` : '';
  return `<svg${classes} viewBox="0 0 40 40" fill="currentColor" aria-hidden="true">
    <rect x="3" y="3" width="15" height="15" rx="2.5"/>
    <rect x="22" y="3" width="15" height="15" rx="2.5" opacity="0.42"/>
    <rect x="3" y="22" width="15" height="15" rx="2.5" opacity="0.42"/>
    <rect x="22" y="22" width="15" height="15" rx="2.5"/>
  </svg>`;
}
