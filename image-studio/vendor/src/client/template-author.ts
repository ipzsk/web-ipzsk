/** Display attribution without turning source metadata into navigation. */
export function templateAuthor(sourceLabel: string): string {
  const label = sourceLabel.trim()
  if (!label || label === '未提供' || label === 'GitHub prompt') return '未署名'
  if (label.startsWith('苍何原创实测')) return '苍何'
  if (label.includes('OpenNana')) return 'OpenNana'
  return label.replace(/ · MIT$/, '')
}
