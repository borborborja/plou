/** Textos de las notificaciones. El resto de la interfaz se traduce en el cliente. */

export type Lang = 'es' | 'ca' | 'en';

export interface NotificationStrings {
  rainOverhead: (place: string) => string;
  snowOverhead: (place: string) => string;
  rainNear: (place: string) => string;
  snowNear: (place: string) => string;
  rainApproaching: (place: string) => string;
  snowApproaching: (place: string) => string;
  cleared: (place: string) => string;
  clearedBody: (place: string) => string;
  bodyDistance: (distance: string, compass: string, intensity: string) => string;
  bodyEta: (minutes: number, compass: string, intensity: string) => string;
  bodyOverhead: (intensity: string, mmh: string) => string;
  bodyMotion: (speed: string, compass: string) => string;
  test: (place: string) => string;
  testBody: string;
  compass: Record<string, string>;
  intensity: Record<string, string>;
}

const compassEs: Record<string, string> = {
  N: 'N',
  NNE: 'NNE',
  NE: 'NE',
  ENE: 'ENE',
  E: 'E',
  ESE: 'ESE',
  SE: 'SE',
  SSE: 'SSE',
  S: 'S',
  SSO: 'SSO',
  SO: 'SO',
  OSO: 'OSO',
  O: 'O',
  ONO: 'ONO',
  NO: 'NO',
  NNO: 'NNO',
};

const compassEn: Record<string, string> = {
  N: 'N',
  NNE: 'NNE',
  NE: 'NE',
  ENE: 'ENE',
  E: 'E',
  ESE: 'ESE',
  SE: 'SE',
  SSE: 'SSE',
  S: 'S',
  SSO: 'SSW',
  SO: 'SW',
  OSO: 'WSW',
  O: 'W',
  ONO: 'WNW',
  NO: 'NW',
  NNO: 'NNW',
};

const intensityEs: Record<string, string> = {
  drizzle: 'llovizna',
  light: 'lluvia débil',
  moderate: 'lluvia moderada',
  heavy: 'lluvia fuerte',
  violent: 'tormenta',
};

const intensityCa: Record<string, string> = {
  drizzle: 'plugim',
  light: 'pluja feble',
  moderate: 'pluja moderada',
  heavy: 'pluja forta',
  violent: 'tempesta',
};

const intensityEn: Record<string, string> = {
  drizzle: 'drizzle',
  light: 'light rain',
  moderate: 'moderate rain',
  heavy: 'heavy rain',
  violent: 'storm',
};

const STRINGS: Record<Lang, NotificationStrings> = {
  es: {
    rainOverhead: (p) => `Está lloviendo en ${p}`,
    snowOverhead: (p) => `Está nevando en ${p}`,
    rainNear: (p) => `Lluvia cerca de ${p}`,
    snowNear: (p) => `Nieve cerca de ${p}`,
    rainApproaching: (p) => `Se acerca lluvia a ${p}`,
    snowApproaching: (p) => `Se acerca nieve a ${p}`,
    cleared: (p) => `Ha escampado en ${p}`,
    clearedBody: (p) => `Ya no se detecta precipitación alrededor de ${p}.`,
    bodyDistance: (d, c, i) => `A ${d} al ${c} · ${i}`,
    bodyEta: (m, c, i) => `Llega en unos ${m} min desde el ${c} · ${i}`,
    bodyOverhead: (i, mmh) => `${i} · ${mmh}`,
    bodyMotion: (s, c) => `Se desplaza a ${s} hacia el ${c}`,
    test: (p) => `Prueba de alarma · ${p}`,
    testBody: 'Si ves este aviso, las notificaciones funcionan correctamente.',
    compass: compassEs,
    intensity: intensityEs,
  },
  ca: {
    rainOverhead: (p) => `Està plovent a ${p}`,
    snowOverhead: (p) => `Està nevant a ${p}`,
    rainNear: (p) => `Pluja a prop de ${p}`,
    snowNear: (p) => `Neu a prop de ${p}`,
    rainApproaching: (p) => `S'acosta pluja a ${p}`,
    snowApproaching: (p) => `S'acosta neu a ${p}`,
    cleared: (p) => `Ha parat de ploure a ${p}`,
    clearedBody: (p) => `Ja no es detecta precipitació al voltant de ${p}.`,
    bodyDistance: (d, c, i) => `A ${d} al ${c} · ${i}`,
    bodyEta: (m, c, i) => `Arriba d'aquí a uns ${m} min des del ${c} · ${i}`,
    bodyOverhead: (i, mmh) => `${i} · ${mmh}`,
    bodyMotion: (s, c) => `Es desplaça a ${s} cap al ${c}`,
    test: (p) => `Prova d'alarma · ${p}`,
    testBody: 'Si veus aquest avís, les notificacions funcionen correctament.',
    compass: compassEs,
    intensity: intensityCa,
  },
  en: {
    rainOverhead: (p) => `It is raining in ${p}`,
    snowOverhead: (p) => `It is snowing in ${p}`,
    rainNear: (p) => `Rain near ${p}`,
    snowNear: (p) => `Snow near ${p}`,
    rainApproaching: (p) => `Rain approaching ${p}`,
    snowApproaching: (p) => `Snow approaching ${p}`,
    cleared: (p) => `It has stopped raining in ${p}`,
    clearedBody: (p) => `No precipitation is detected around ${p} any more.`,
    bodyDistance: (d, c, i) => `${d} to the ${c} · ${i}`,
    bodyEta: (m, c, i) => `Arriving in about ${m} min from the ${c} · ${i}`,
    bodyOverhead: (i, mmh) => `${i} · ${mmh}`,
    bodyMotion: (s, c) => `Moving at ${s} towards the ${c}`,
    test: (p) => `Alarm test · ${p}`,
    testBody: 'If you can see this, notifications are working.',
    compass: compassEn,
    intensity: intensityEn,
  },
};

export function strings(lang: string | undefined): NotificationStrings {
  if (lang === 'ca') return STRINGS.ca;
  if (lang === 'en') return STRINGS.en;
  return STRINGS.es;
}
