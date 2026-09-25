/**
 * Design Tokens - Centralización de valores de diseño
 *
 * Este archivo contiene todos los valores mágicos y configuraciones
 * de diseño del proyecto para facilitar mantenimiento y consistencia.
 */

export const designTokens = {
  // ====== COLORES ======
  colors: {
    geoGreen: {
      DEFAULT: '#10b981',
      light: '#34d399',
      dark: '#059669',
    },
    geoCyan: {
      DEFAULT: '#06b6d4',
      light: '#22d3ee',
    },
    geoDark: {
      DEFAULT: '#020a12',
      100: '#04121d',
      200: '#061524',
      300: '#071a29',
      400: '#0a2133',
    },
    // ====== Topografía Viva (O2) palette ======
    // Paper-and-ink editorial scheme — warm earth tones anchored by deep forest.
    o2: {
      paper: '#e6e4d8',
      paperWarm: '#eeebdf',
      paperPale: '#f4f2ea',
      forest: '#1c3328',
      forestDeep: '#0d1f15',
      // #0f5636 y no #157049: sube de 4.78:1 a 6.84:1 sobre paper y, sobre las
      // superficies teñidas de emerald/15, de 3.93:1 (falla AA texto) a 5.63:1.
      emerald: '#0f5636',
      emeraldLight: '#2eb479',
      sage: '#a8bd92',
      sageDeep: '#6e8a5e',
      teal: '#2f6e78',
      ochre: '#c8941a',
      // ochre sirve para avisos sobre el fondo bosque (4.5:1 largo), pero sobre
      // papel se queda en 2.28:1 — falla AA texto de lejos. Esta es la variante
      // para papel: mismo tono, oscurecida lo justo para pasar en los tres
      // papeles (paper 4.82, paper-warm 5.15, paper-pale 5.49).
      ochreDeep: '#8f5310',
      ink: '#15211a',
    },
  },

  // ====== SOMBRAS ======
  shadows: {
    // Sombras de glow
    glowGreen: {
      sm: '0 0 20px rgba(16, 185, 129, 0.3)',
      md: '0 0 30px rgba(16, 185, 129, 0.3)',
      lg: '0 0 30px rgba(16, 185, 129, 0.8), 0 0 40px rgba(16, 185, 129, 0.4)',
    },
    glowCyan: {
      md: '0 0 30px rgba(6, 182, 212, 0.3)',
    },
    // Sombra de borde sutil
    cardBorder: '0 0 0 1px rgba(255, 255, 255, 0.04)',
    // Sombra de hover en cards
    cardHover: '0 25px 50px -12px rgba(16, 185, 129, 0.1)',
  },

  // ====== TIPOGRAFÍA ======
  typography: {
    // Tamaños personalizados
    sizes: {
      xxs: '0.65rem',    // 10.4px - Para labels muy pequeños
      '2xs': '0.7rem',   // 11.2px - Para textos compactos
    },
    // Letter spacing
    tracking: {
      wider: '0.15em',
      widest: '0.2em',
    },
  },

  // ====== ANIMACIONES ======
  animations: {
    durations: {
      slow: '4s',
      float: '6s',
      glow: '2s',
    },
    timings: {
      ease: 'cubic-bezier(0.4, 0, 0.6, 1)',
      easeInOut: 'ease-in-out',
    },
  },

  // ====== GRADIENTES ======
  gradients: {
    // Fondo principal oscuro
    dark: 'radial-gradient(60% 80% at 70% 10%, #0b6070 0%, #04121d 55%, #020a12 100%)',
    // Hero section
    hero: 'radial-gradient(600px 200px at 70% -10%, rgba(16, 185, 129, 0.25), transparent)',
  },

  // ====== BLUR ======
  blur: {
    heroGlow: '3rem', // 48px
  },

  // ====== BORDER RADIUS ======
  borderRadius: {
    card: '1.5rem', // 24px
    cardLg: '2rem', // 32px
  },
}

export default designTokens
