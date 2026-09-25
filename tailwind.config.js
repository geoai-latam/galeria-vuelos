const { designTokens } = require('./styles/design-tokens')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      // ====== COLORES ======
      colors: {
        geo: {
          green: designTokens.colors.geoGreen.DEFAULT,
          'green-light': designTokens.colors.geoGreen.light,
          'green-dark': designTokens.colors.geoGreen.dark,
          cyan: designTokens.colors.geoCyan.DEFAULT,
          'cyan-light': designTokens.colors.geoCyan.light,
          dark: designTokens.colors.geoDark,
          // Topografía Viva (O2) palette — used by the homepage redesign
          paper: designTokens.colors.o2.paper,
          'paper-warm': designTokens.colors.o2.paperWarm,
          'paper-pale': designTokens.colors.o2.paperPale,
          forest: designTokens.colors.o2.forest,
          'forest-deep': designTokens.colors.o2.forestDeep,
          emerald: designTokens.colors.o2.emerald,
          'emerald-light': designTokens.colors.o2.emeraldLight,
          sage: designTokens.colors.o2.sage,
          'sage-deep': designTokens.colors.o2.sageDeep,
          teal: designTokens.colors.o2.teal,
          ochre: designTokens.colors.o2.ochre,
          'ochre-deep': designTokens.colors.o2.ochreDeep,
          ink: designTokens.colors.o2.ink,
          // geo.blue y geo.gray se borraron: eran dos escalas completas (21
          // tonos) sin un solo consumidor en el repo, y encima hardcodeadas
          // acá en vez de venir de design-tokens.js, que es justo lo que el
          // "single source of truth" prohíbe. Mover código muerto no arregla
          // nada; borrarlo sí.
        },
      },

      // ====== TIPOGRAFÍA ======
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        // O2 typography — Familjen Grotesk for headlines, DM Sans for body.
        display: ['"Familjen Grotesk"', '"DM Sans"', 'system-ui', 'sans-serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xxs: [designTokens.typography.sizes.xxs, { lineHeight: '1rem' }],
        '2xs': [designTokens.typography.sizes['2xs'], { lineHeight: '1rem' }],
      },
      letterSpacing: {
        wider: designTokens.typography.tracking.wider,
        widest: designTokens.typography.tracking.widest,
      },

      // ====== SOMBRAS ======
      boxShadow: {
        'glow-green-sm': designTokens.shadows.glowGreen.sm,
        'glow-green': designTokens.shadows.glowGreen.md,
        'glow-green-lg': designTokens.shadows.glowGreen.lg,
        'glow-cyan': designTokens.shadows.glowCyan.md,
        'card-border': designTokens.shadows.cardBorder,
        'card-hover': designTokens.shadows.cardHover,
      },

      // ====== ANIMACIONES ======
      animation: {
        'pulse-slow': `pulse ${designTokens.animations.durations.slow} ${designTokens.animations.timings.ease} infinite`,
        'float': `float ${designTokens.animations.durations.float} ${designTokens.animations.timings.easeInOut} infinite`,
        'glow': `glow ${designTokens.animations.durations.glow} ${designTokens.animations.timings.easeInOut} infinite alternate`,
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        glow: {
          '0%': { boxShadow: designTokens.shadows.glowGreen.sm },
          '100%': { boxShadow: designTokens.shadows.glowGreen.lg },
        },
      },

      // ====== BACKGROUNDS ======
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },

      // ====== BLUR ======
      blur: {
        'hero': designTokens.blur.heroGlow,
      },

      // ====== BORDER RADIUS ======
      borderRadius: {
        'card': designTokens.borderRadius.card,
        'card-lg': designTokens.borderRadius.cardLg,
      },
    },
  },
  plugins: [],
}
