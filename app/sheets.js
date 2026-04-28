// Bottom-sheet open/close helpers — gedeeld door alle views.
export function openSheet() {
  document.getElementById('sheetBg').classList.add('open');
  setTimeout(() => document.getElementById('sheet').classList.add('open'), 10);
}
export function closeSheet() {
  document.getElementById('sheet').classList.remove('open');
  setTimeout(() => document.getElementById('sheetBg').classList.remove('open'), 200);
}
