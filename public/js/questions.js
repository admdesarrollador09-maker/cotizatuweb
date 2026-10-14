// Reglas compartidas (navegador y servidor) para decidir qué preguntas y funciones se muestran.
// No contiene precios.

export function formatPEN(cents) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const soles = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '- ' : ''}S/ ${soles}.${String(abs % 100).padStart(2, '0')}`;
}

export const PERIOD_LABEL = { mensual: 'mensual', anual: 'anual', unico: 'pago único' };

export const GROUPS = [
  { key: 'design', title: 'Tipo de diseño', question: '¿Prefieres una plantilla adaptada o un diseño exclusivo?' },
  { key: 'content', title: 'Textos', question: '¿Entregarás los textos o necesitas que los redactemos?' },
  { key: 'languages', title: 'Idiomas', question: '¿En cuántos idiomas estará?' },
  { key: 'deadline', title: 'Plazo de entrega', question: '¿Con qué urgencia lo necesitas?' },
];

export const FEATURE_CATEGORIES = [
  { key: 'general', title: 'Funciones generales' },
  { key: 'tienda', title: 'Funciones de tienda virtual' },
  { key: 'app', title: 'Funciones de aplicación web' },
];

/** 'included' | 'available' | null */
export function featureMode(feature, serviceId) {
  return (feature.compat && feature.compat[serviceId]) || null;
}

/** ¿Esta pregunta aplica al servicio y a las respuestas actuales? */
export function questionVisible(q, sel, config) {
  if (!q.services.includes(Number(sel.serviceId))) return false;
  if (q.type === 'feature') {
    const f = config.features.find((x) => x.id === q.featureId);
    if (!f || !featureMode(f, sel.serviceId)) return false;
  }
  const cond = q.showIf;
  if (!cond) return true;
  if (cond.key === '__pages') return cond.values.includes(Number(sel.pageRange));
  // "a|b" con "not-first": se muestra si alguna de esas preguntas tiene una respuesta distinta de la primera opción.
  const keys = cond.key.split('|');
  return keys.some((k) => {
    const other = config.questions.find((x) => x.key === k);
    const v = sel.answers?.[k];
    if (!other || v === undefined || v === null || v === '') return false;
    if (!questionVisible(other, sel, config)) return false;
    if (cond.values.includes('not-first')) return Number(v) !== other.options[0]?.id;
    return cond.values.includes(Number(v));
  });
}

export function serviceUsesPages(service) {
  return service && service.kind === 'web';
}
