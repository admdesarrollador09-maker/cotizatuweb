// Opciones del paso 4 (datos del cliente) y validaciones compartidas entre navegador y servidor.

export const BUDGETS = [
  ['', 'Prefiero no indicarlo'],
  ['hasta_1000', 'Hasta S/ 1,000'],
  ['1000_2500', 'De S/ 1,000 a S/ 2,500'],
  ['2500_5000', 'De S/ 2,500 a S/ 5,000'],
  ['mas_5000', 'Más de S/ 5,000'],
];

export const DOMAIN = [
  ['si', 'Sí, ya tengo dominio'],
  ['no', 'No, aún no tengo'],
  ['no_seguro', 'No estoy seguro'],
];

export const DESIRED = [
  ['', 'Sin fecha definida'],
  ['2_semanas', 'En menos de 2 semanas'],
  ['1_mes', 'En 2 a 4 semanas'],
  ['2_meses', 'En 1 a 2 meses'],
  ['mas_2_meses', 'En más de 2 meses'],
];

export const labelOf = (list, v) => (list.find(([k]) => k === v) || [, ''])[1];

export const STATUSES = [
  ['nueva', 'Nueva solicitud'],
  ['pendiente', 'Pendiente de revisión'],
  ['enviada', 'Cotización enviada'],
  ['negociacion', 'En negociación'],
  ['aceptada', 'Aceptada'],
  ['rechazada', 'Rechazada'],
  ['ejecucion', 'Proyecto en ejecución'],
];

export const CHANNELS = { pdf: 'Descarga de PDF', whatsapp: 'WhatsApp', propuesta: 'Propuesta personalizada' };

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

export function normalizePhone(v) {
  return String(v || '').replace(/[^\d]/g, '');
}

/** Devuelve { campo: mensaje } con los errores encontrados. */
export function validateClient(d) {
  const e = {};
  const name = String(d.name || '').trim();
  const email = String(d.email || '').trim();
  const phone = normalizePhone(d.whatsapp);
  const desc = String(d.description || '').trim();
  if (name.length < 3) e.name = 'Escribe tu nombre y apellido.';
  else if (name.length > 100) e.name = 'El nombre es demasiado largo.';
  if (String(d.company || '').length > 120) e.company = 'El nombre de la empresa es demasiado largo.';
  if (!email) e.email = 'Escribe tu correo electrónico.';
  else if (email.length > 254 || !EMAIL_RE.test(email)) e.email = 'Revisa el formato del correo (ejemplo: nombre@empresa.com).';
  if (!phone) e.whatsapp = 'Escribe tu número de WhatsApp.';
  else if (phone.length < 9 || phone.length > 15) e.whatsapp = 'El número debe tener entre 9 y 15 dígitos.';
  if (!DOMAIN.some(([k]) => k === d.hasDomain)) e.hasDomain = 'Indica si tienes dominio propio.';
  if (!BUDGETS.some(([k]) => k === (d.budget || ''))) e.budget = 'Opción no válida.';
  if (!DESIRED.some(([k]) => k === (d.desiredDeadline || ''))) e.desiredDeadline = 'Opción no válida.';
  if (desc.length < 10) e.description = 'Cuéntanos brevemente tu proyecto (mínimo 10 caracteres).';
  else if (desc.length > 2000) e.description = 'La descripción no debe superar los 2000 caracteres.';
  if (d.consent !== true) e.consent = 'Necesitamos tu autorización para contactarte.';
  return e;
}
