// Small flat illustrations for the scenario cards (viewBox 200x110). Kept as inline SVG strings
// so the menu needs no image assets; gradient ids are prefixed per icon because every inline
// <svg> in the page shares one id namespace.

const SKY = (id) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aaee6"/><stop offset="1" stop-color="#d4ecf9"/></linearGradient></defs>`;

// Perspective view down a two-lane avenue with a car ahead.
const straight = `<svg viewBox="0 0 200 110" xmlns="http://www.w3.org/2000/svg">
  ${SKY('icoSkyStraight')}
  <rect width="200" height="110" fill="url(#icoSkyStraight)"/>
  <g>
    <rect x="0" y="34" width="30" height="60" fill="#c8896b"/><rect x="26" y="46" width="24" height="48" fill="#d9c79e"/>
    <rect x="52" y="52" width="20" height="40" fill="#9fb6c9"/>
    <rect x="170" y="34" width="30" height="60" fill="#b98d6f"/><rect x="150" y="46" width="24" height="48" fill="#dfe3e6"/>
    <rect x="128" y="52" width="20" height="40" fill="#cbb4d1"/>
  </g>
  <polygon points="0,110 200,110 108,56 92,56" fill="#3a3a3f"/>
  <polygon points="0,110 -30,110 90,56 92,56" fill="#b9b6ad"/>
  <polygon points="200,110 230,110 110,56 108,56" fill="#b9b6ad"/>
  <polygon points="99,56 101,56 104,110 96,110" fill="#ffcc00"/>
  <g fill="#fff" opacity="0.9">
    <polygon points="139,110 143,110 118,76 117,76"/><polygon points="61,110 57,110 82,76 83,76"/>
    <polygon points="112,64 113,64 116,72 114,72"/><polygon points="88,64 87,64 84,72 86,72"/>
  </g>
  <g transform="translate(124 84)">
    <rect x="0" y="0" width="28" height="14" rx="3" fill="#1565c0"/><rect x="4" y="-5" width="20" height="8" rx="2" fill="#1e88e5"/>
    <rect x="2" y="9" width="5" height="3" fill="#ff5252"/><rect x="21" y="9" width="5" height="3" fill="#ff5252"/>
  </g>
</svg>`;

// Wide three-lane highway with dense traffic.
const highway = `<svg viewBox="0 0 200 110" xmlns="http://www.w3.org/2000/svg">
  ${SKY('icoSkyHighway')}
  <rect width="200" height="110" fill="url(#icoSkyHighway)"/>
  <rect x="0" y="52" width="200" height="14" fill="#8aa07a"/>
  <polygon points="0,110 200,110 132,54 68,54" fill="#3a3a3f"/>
  <polygon points="99,54 101,54 103,110 97,110" fill="#ffcc00"/>
  <g fill="#fff" opacity="0.9">
    <polygon points="122,110 127,110 107,62 105,62"/><polygon points="150,110 156,110 116,62 114,62"/>
    <polygon points="78,110 73,110 93,62 95,62"/><polygon points="50,110 44,110 84,62 86,62"/>
  </g>
  <g><rect x="120" y="70" width="12" height="7" rx="2" fill="#cc2b2b"/><rect x="136" y="88" width="20" height="10" rx="2" fill="#f9a825"/>
     <rect x="72" y="72" width="11" height="6" rx="2" fill="#2e7d32"/><rect x="46" y="92" width="22" height="11" rx="2" fill="#6a1b9a"/>
     <rect x="108" y="64" width="8" height="5" rx="1" fill="#455a64"/><rect x="84" y="82" width="15" height="8" rx="2" fill="#1e88e5"/></g>
</svg>`;

// Top-down city grid with buildings and a traffic light.
const grid = `<svg viewBox="0 0 200 110" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="110" fill="#5b7148"/>
  <g fill="#3a3a3f"><rect x="0" y="40" width="200" height="16"/><rect x="0" y="86" width="200" height="14"/>
     <rect x="52" y="0" width="16" height="110"/><rect x="132" y="0" width="16" height="110"/></g>
  <g fill="#ffcc00" opacity="0.9"><rect x="0" y="47.5" width="200" height="1.5"/><rect x="0" y="92.5" width="200" height="1.5"/>
     <rect x="59.2" y="0" width="1.5" height="110"/><rect x="139.2" y="0" width="1.5" height="110"/></g>
  <g><rect x="6" y="6" width="40" height="28" fill="#d9c79e"/><rect x="76" y="8" width="50" height="26" fill="#c8896b"/>
     <rect x="156" y="6" width="38" height="30" fill="#9fb6c9"/><rect x="8" y="60" width="38" height="22" fill="#cbb4d1"/>
     <rect x="76" y="60" width="50" height="22" fill="#dfe3e6"/><rect x="156" y="60" width="38" height="22" fill="#e8d5a0"/></g>
  <g stroke="#fff" stroke-width="2"><line x1="54" y1="58" x2="66" y2="58"/><line x1="134" y1="58" x2="146" y2="58"/></g>
  <g transform="translate(60 18)"><rect width="7" height="13" rx="2" fill="#cc2b2b"/></g>
  <g transform="translate(108 43)"><rect width="13" height="7" rx="2" fill="#1e88e5"/></g>
  <g transform="translate(20 89)"><rect width="13" height="7" rx="2" fill="#f9a825"/></g>
  <rect x="148" y="34" width="6" height="16" rx="2" fill="#151515"/><circle cx="151" cy="38" r="1.8" fill="#ff3b30"/><circle cx="151" cy="43" r="1.8" fill="#3a3a00"/><circle cx="151" cy="47.5" r="1.8" fill="#0a4d0a"/>
</svg>`;

export const SCENARIO_ICONS = { straight, highway, grid };
