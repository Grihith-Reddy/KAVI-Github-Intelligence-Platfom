export function formatLineRange(start?: number | null, end?: number | null) {
  if (!start && !end) return 'Lines unknown'
  if (start && !end) return `Line ${start}`
  if (!start && end) return `Up to line ${end}`
  if (start === end) return `Line ${start}`
  return `Lines ${start}-${end}`
}
