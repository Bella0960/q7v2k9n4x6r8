/* MAOMAO Thin Shadow — original, unified 24px line icon set.
   Curated to the geometry used by established open line-icon systems
   (Lucide / Tabler): 24x24 box, 1.55px optical stroke, rounded caps.
   No external request, emoji, font dependency, or raster asset. */
(function (global) {
 'use strict';
 var paths = Object.freeze({
  back:'<path d="m14.5 18-6-6 6-6"/>',
  menu:'<path d="M4.5 8h15M4.5 16h15"/>',
  plus:'<path d="M12 4.7v14.6M4.7 12h14.6"/>',
  close:'<path d="M6 6l12 12M18 6 6 18"/>',
  tone:'<circle cx="12" cy="12" r="8.1"/><path d="M12 3.9a8.1 8.1 0 0 1 0 16.2Z" fill="currentColor" stroke="none"/>',
  photo:'<rect x="3.2" y="3.6" width="17.6" height="16.8" rx="2.6"/><circle cx="8.8" cy="9.2" r="1.5"/><path d="m4.2 17 5-4.8 3.2 3.1 3.2-4 4.2 5.1"/>',
  sticker:'<path d="M13.3 20.3H7a3.3 3.3 0 0 1-3.3-3.3V7A3.3 3.3 0 0 1 7 3.7h10A3.3 3.3 0 0 1 20.3 7v6.3L13.3 20.3Z"/><path d="M13.3 20.3v-4a3 3 0 0 1 3-3h4"/><path d="M8.1 10.5h.01M14 10.5h.01M8.6 13.7c1.5 1.6 3.8 1.6 5.3 0"/>',
  microphone:'<rect x="9" y="3.4" width="6" height="11.9" rx="3"/><path d="M5.6 10.9a6.4 6.4 0 0 0 12.8 0M12 17.3v3.3M8.6 20.6h6.8"/>',
  location:'<path d="M19.5 10.25c0 5.5-7.5 11.25-7.5 11.25S4.5 15.75 4.5 10.25a7.5 7.5 0 1 1 15 0Z"/><circle cx="12" cy="10.15" r="2.5"/>',
  more:'<circle cx="5.5" cy="12" r="1.15"/><circle cx="12" cy="12" r="1.15"/><circle cx="18.5" cy="12" r="1.15"/>',
  search:'<circle cx="10.9" cy="10.9" r="7"/><path d="m16 16 4.3 4.3"/>',
  people:'<circle cx="9" cy="8.5" r="3.2"/><path d="M3.7 19.5c0-5.7 10.6-5.7 10.6 0M16.3 5.7a3 3 0 0 1 0 5.6M17.4 15c1.8.4 2.9 2 2.9 4.5"/>',
  moments:'<rect x="3.5" y="3.5" width="17" height="17" rx="2.4"/><circle cx="8.6" cy="8.7" r="1.4"/><path d="m4.3 17 4.6-4.6 3.2 3 3.1-4 4.4 5.6"/>',
  clock:'<circle cx="12" cy="12" r="8.4"/><path d="M12 7.2v5.2l3.4 2"/>',
  diary:'<rect x="5" y="3.4" width="14" height="17.2" rx="2"/><path d="M8.4 8.4h7.2M8.4 12.2h7.2M8.4 16h4.4"/>',
  person:'<circle cx="12" cy="8.1" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
  music:'<path d="M9 17.8V5.2l11-2v12.9"/><circle cx="6.2" cy="18" r="2.8"/><circle cx="17.2" cy="16.3" r="2.8"/>',
  video:'<rect x="3.2" y="6" width="12.8" height="12" rx="2.5"/><path d="m16 10 4.8-2.6v9.2L16 14"/>',
  send:'<path d="m20.5 3.5-7 17-3.4-6.6-6.6-3.4 17-7Z"/><path d="m10.1 13.9 10.4-10.4"/>',
  spark:'<path d="m12 2.8 2.4 6.8 6.8 2.4-6.8 2.4-2.4 6.8-2.4-6.8-6.8-2.4 6.8-2.4L12 2.8Z"/>',
  heart:'<path d="M20.1 5.3a4.8 4.8 0 0 0-6.8 0L12 6.6l-1.3-1.3a4.8 4.8 0 0 0-6.8 6.8L12 20.2l8.1-8.1a4.8 4.8 0 0 0 0-6.8Z"/>',
  share:'<path d="M12 15V3.7m0 0L8 7.8m4-4.1 4 4.1M5.2 13.4v5.3c0 1 .8 1.8 1.8 1.8h10c1 0 1.8-.8 1.8-1.8v-5.3"/>',
  gift:'<rect x="4" y="10" width="16" height="11" rx="1.5"/><path d="M3 7.1h18V10H3zM12 7.1V21"/><path d="M12 7c-4-6.3-9.4-1.2-4.7.1H12Zm0 0c4-6.3 9.4-1.2 4.7.1H12Z"/>',
  refresh:'<path d="M20.5 10a8.5 8.5 0 0 0-14.7-4.8L3.5 7.5M3.5 3.9v3.6h3.6M3.5 14a8.5 8.5 0 0 0 14.7 4.8l2.3-2.3M20.5 20.1v-3.6h-3.6"/>'
 });
 function markup(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(paths[name]||paths.more)+'</svg>';
 }
 function apply(svg,name){
  if(!svg||!paths[name])return false;
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');
  svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.55');
  svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  svg.setAttribute('aria-hidden','true');svg.innerHTML=paths[name];return true;
 }
 global.MAOMAOAtmosphereIcons=Object.freeze({paths:paths,markup:markup,apply:apply});
})(window);
