// Configuración plana de ESLint (ESLint 9).
//
// Reemplaza a `.eslintrc.json` + `next lint`: Next 16 eliminó el subcomando
// `lint`, así que el linter se invoca por la CLI de ESLint. `eslint-config-next`
// 16 ya exporta config plana, así que no hace falta FlatCompat.

import coreWebVitals from 'eslint-config-next/core-web-vitals'

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      // Lo copia scripts/copiar-maplibre.js desde node_modules.
      'public/maplibre/**',
      // El transcodificador de Basis (KTX2) viene compilado de three.js.
      'public/basis/**',
      // La tubería son scripts de Node y Python que corren fuera de Next, con
      // sus propias dependencias: las reglas de core-web-vitals no aplican.
      'tuberia/**',
    ],
  },
  ...coreWebVitals,
]

export default config
