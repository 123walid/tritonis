// Tritonis theme tokens — SPEC §2. Light theme only, sunlight-readable.
export const colors = {
  primary: '#1E5560', // deep teal
  secondary: '#458D93', // mid teal
  accent: '#CF4908', // copper — primary actions, alerts
  cream: '#F7EFE2', // light backgrounds
  bg: '#FBF8F2',
  surface: '#FFFFFF',
  text: '#1A2E32',
  textMuted: '#5B7075',
  border: '#E3DCCF',
  success: '#2E7D4F',
  danger: '#B3261E',
  warning: '#CF4908',
  offline: '#9AA5A8',
};

export const spacing = (n: number): number => n * 4;

export const radius = { sm: 8, md: 14, lg: 22, full: 999 };

// min body 17 — sunlight readability
export const font = { title: 28, h2: 22, body: 17, small: 14, hero: 40 };

export const hitSlop = { top: 12, bottom: 12, left: 12, right: 12 };

export const minTouch = 56;
