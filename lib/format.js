// Helpers puros de formato — sin dependencias de Node (fs/path).
// Seguros de importar desde componentes de cliente.

export function formatDate(dateString) {
  const date = new Date(dateString)
  return date.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    // "YYYY-MM-DD" se parsea como medianoche UTC. Sin fijar la zona,
    // toLocaleDateString formatea en la del visitante y en todo LATAM (UTC-3 a
    // UTC-6) muestra el día anterior, además de descuadrar la hidratación.
    timeZone: 'UTC',
  })
}

// Fecha de un vuelo: "2026-01-31" o solo "2026-02" cuando no se sabe el día.
// Con solo el mes, `new Date` pondría el día 1 y la página diría una fecha que
// nadie anotó; por eso se formatea sin día.
export function formatFechaVuelo(fecha) {
  if (!fecha) return ''
  if (/^\d{4}-\d{2}$/.test(fecha)) {
    return new Date(`${fecha}-01`).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    })
  }
  return formatDate(fecha)
}
