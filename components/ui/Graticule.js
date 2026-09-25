// Cartographic graticule — the signature scaffolding of the site.
// A faint coordinate grid with survey-sheet tick labels (LATAM lon/lat) and
// registration crosses at intersections. Structure grounded in the subject
// (maps / survey sheets), not decoration. Full-bleed absolute backdrop —
// drop it inside a `relative` section like the old ContourField.

const LON = ['110°W', '95°W', '80°W', '65°W', '50°W', '35°W']
const LAT = ['20°N', '5°N', '10°S', '25°S', '40°S']

export const Graticule = ({
  className = '',
  color = '#1c3328',
  lineOpacity = 0.09,
  labelOpacity = 0.4,
  cols = 6,
  rows = 5,
  labels = true,
}) => {
  const W = 1200
  const H = 760
  const xs = Array.from({ length: cols + 1 }, (_, i) => Math.round((i * W) / cols))
  const ys = Array.from({ length: rows + 1 }, (_, i) => Math.round((i * H) / rows))

  return (
    <svg
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {/* graticule lines */}
      <g stroke={color} strokeWidth="1" fill="none" style={{ opacity: lineOpacity }}>
        {xs.map((x, i) => (
          <line key={`v${i}`} x1={x} y1="0" x2={x} y2={H} />
        ))}
        {ys.map((y, i) => (
          <line key={`h${i}`} x1="0" y1={y} x2={W} y2={y} />
        ))}
      </g>

      {/* registration crosses at intersections — survey-sheet feel */}
      <g stroke={color} strokeWidth="1" style={{ opacity: Math.min(1, lineOpacity * 2.4) }}>
        {xs.map((x) =>
          ys.map((y) => (
            <g key={`c${x}-${y}`}>
              <line x1={x - 5} y1={y} x2={x + 5} y2={y} />
              <line x1={x} y1={y - 5} x2={x} y2={y + 5} />
            </g>
          ))
        )}
      </g>

      {/* edge tick labels — plausible LATAM graticule */}
      {labels && (
        <g
          fill={color}
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          fontSize="10.5"
          letterSpacing="0.06em"
          style={{ opacity: labelOpacity }}
        >
          {xs.slice(0, -1).map((x, i) => (
            <text key={`lx${i}`} x={x + 7} y={16}>
              {LON[i % LON.length]}
            </text>
          ))}
          {ys.slice(1).map((y, i) => (
            <text key={`ly${i}`} x={7} y={y - 7}>
              {LAT[i % LAT.length]}
            </text>
          ))}
        </g>
      )}
    </svg>
  )
}

export default Graticule
