// Dark kitchen theme. Large targets, high contrast — the user has wet hands and a phone propped on the counter.
export const colors = {
  bg: '#0b0b0f',
  card: '#17171d',
  card2: '#20202a',
  border: '#2b2b36',
  text: '#f5f5f7',
  muted: '#9a9aa3',
  accent: '#ff7a1a',
  accentText: '#1a0d00',
  green: '#3ddc84',
  red: '#ff5c5c',
  amber: '#ffc14d',
  overlay: 'rgba(0,0,0,0.58)',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 24, pill: 999 } as const;
export const font = { body: 17, big: 20, title: 28, cook: 22 } as const;
