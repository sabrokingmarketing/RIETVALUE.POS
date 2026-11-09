// Generates simple, clearly-placeholder plant illustrations for development data.
// Real deployments replace these with the nursery's own photographs.
import fs from "node:fs";
const pot = (c) => `<path d="M230 470 L250 600 Q252 612 264 612 L536 612 Q548 612 550 600 L570 470 Z" fill="${c}"/><rect x="215" y="448" width="370" height="34" rx="8" fill="${c}" opacity=".85"/>`;
const bg = (a, b) => `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="640" fill="url(#g)"/><ellipse cx="400" cy="616" rx="230" ry="14" fill="#203028" opacity=".08"/>`;
const leaf = (x, y, len, ang, w, c) => `<path transform="translate(${x} ${y}) rotate(${ang})" d="M0 0 Q ${w} ${-len / 2} 0 ${-len} Q ${-w} ${-len / 2} 0 0Z" fill="${c}"/>`;
const arts = {
  lavender: () => {
    let s = "";
    for (let i = 0; i < 13; i++) { const a = -48 + i * 8; s += `<g transform="translate(400 452) rotate(${a})"><rect x="-2" y="-250" width="4" height="250" fill="#6f8f5a"/>${Array.from({ length: 9 }, (_, k) => `<ellipse cx="0" cy="${-250 + k * 9}" rx="9" ry="7" fill="${k % 2 ? "#8b6cc4" : "#7a5ab5"}"/>`).join("")}</g>`; }
    for (let i = 0; i < 16; i++) s += leaf(400, 452, 90, -70 + i * 9, 8, "#9fb28a");
    return bg("#f3eefa", "#e9f2e4") + s + pot("#c9734f");
  },
  succulent: () => {
    let s = "";
    for (let r = 0; r < 3; r++) for (let i = 0; i < 9; i++) s += leaf(400, 452, 150 - r * 40, i * 40 + r * 20, 42 - r * 8, ["#7fa889", "#8fbc9a", "#a9cfb1"][r]);
    return bg("#eef5f1", "#f6f3ec") + s + pot("#e0d6c6");
  },
  aloe: () => {
    let s = "";
    for (let i = 0; i < 11; i++) s += leaf(400, 456, 240 - Math.abs(i - 5) * 18, -75 + i * 15, 22, i % 2 ? "#5f8f63" : "#6fa071");
    return bg("#fbf1e6", "#eef3e8") + s + pot("#a9583b");
  },
  fern: () => {
    let s = "";
    for (let i = 0; i < 9; i++) { const a = -80 + i * 20; s += `<g transform="translate(400 452) rotate(${a})"><path d="M0 0 Q 20 -120 0 -230" stroke="#3f7a45" stroke-width="4" fill="none"/>${Array.from({ length: 12 }, (_, k) => leaf(0, -20 - k * 17, 34 - k * 2, k % 2 ? 70 : -70, 7, "#4f9256")).join("")}</g>`; }
    return bg("#e8f3ea", "#f4f6f4") + s + pot("#3c4a43");
  },
  strelitzia: () => {
    let s = "";
    for (let i = 0; i < 6; i++) { const a = -40 + i * 16; s += `<g transform="translate(400 452) rotate(${a})"><rect x="-3" y="-200" width="6" height="200" fill="#4b7d4f"/>${leaf(0, -190, 170, 0, 48, "#3f7546")}</g>`; }
    s += `<g transform="translate(470 220) rotate(-15)"><path d="M0 0 L110 10 L0 22Z" fill="#2b6b8c"/><path d="M10 0 L50 -70 L60 0Z" fill="#f08a24"/><path d="M30 2 L80 -55 L75 4Z" fill="#f5a623"/></g>`;
    return bg("#fdf3e7", "#eaf2e6") + s + pot("#efe9df");
  },
  monstera: () => {
    let s = "";
    for (let i = 0; i < 7; i++) { const a = -60 + i * 20; s += `<g transform="translate(400 452) rotate(${a})"><rect x="-3" y="-170" width="6" height="170" fill="#4d7a50"/><ellipse cx="0" cy="-230" rx="72" ry="66" fill="#2f6e3d"/><path d="M0 -296 L0 -166 M0 -230 L-60 -260 M0 -215 L60 -245 M0 -200 L-62 -215 M0 -190 L62 -200" stroke="#eaf5e7" stroke-width="7"/></g>`; }
    return bg("#eef4ee", "#f4f6f4") + s + pot("#d9c7a8");
  },
  potonly: () => bg("#f6f1ea", "#f4f6f4") + `<g transform="translate(0 -60) scale(1 1.25) translate(0 -80)">${pot("#b8603f")}</g>`,
  compost: () => bg("#f1efe8", "#eaf2e6") + `<path d="M270 200 L530 200 L560 600 L240 600 Z" fill="#6b4f3a"/><rect x="300" y="300" width="200" height="140" rx="10" fill="#eaf5e7"/><path d="M340 400 q60 -80 120 0" stroke="#215c39" stroke-width="12" fill="none"/>`,
  rose: () => {
    let s = "";
    for (let i = 0; i < 12; i++) s += leaf(400, 452, 120, -80 + i * 14, 20, "#4a7d45");
    for (const [x, y] of [[340, 250], [430, 220], [470, 300], [370, 320]]) s += `<circle cx="${x}" cy="${y}" r="34" fill="#d6455d"/><circle cx="${x}" cy="${y}" r="20" fill="#e66a7e"/><circle cx="${x}" cy="${y}" r="9" fill="#c23651"/>`;
    return bg("#fbeef0", "#eef3e8") + s + pot("#8a8f8b");
  },
};
for (const [name, fn] of Object.entries(arts)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 640" role="img" aria-label="Placeholder illustration">${fn()}<text x="24" y="36" font-family="sans-serif" font-size="18" fill="#203028" opacity=".55">PLACEHOLDER — replace with your photo</text></svg>`;
  fs.writeFileSync(`public/fixtures/${name}.svg`, svg);
}
console.log(Object.keys(arts).join(", "));
