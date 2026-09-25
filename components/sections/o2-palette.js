// Shared Topografía Viva (O2) colour tokens.
// Single source of truth — import from here in any O2 component instead
// of redeclaring the literal hex values. Mirrors the entries exposed to
// Tailwind via design-tokens.js / tailwind.config.js (e.g. text-geo-emerald
// resolves to PALETTE.emerald).

export const PALETTE = {
  paper: '#e6e4d8',
  paperWarm: '#eeebdf',
  paperPale: '#f4f2ea',
  forest: '#1c3328',
  forestDeep: '#0d1f15',
  emerald: '#157049',
  emeraldLight: '#2eb479',
  sage: '#a8bd92',
  sageDeep: '#6e8a5e',
  teal: '#2f6e78',
  ochre: '#c8941a',
  ink: '#15211a',
}

export default PALETTE
