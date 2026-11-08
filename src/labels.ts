export const CATEGORY_LABELS: Record<string, string> = {
  foliage: 'צמח עלים',
  flowering: 'צמח פורח',
  succulent: 'סוקולנט',
  cactus: 'קקטוס',
  herb: 'תבלין',
  fern: 'שרך',
  palm: 'דקל',
  vine: 'מטפס',
  tree: 'עץ',
  other: 'אחר',
}

export const LIGHT_LABELS: Record<string, string> = {
  low: 'אור נמוך',
  medium: 'אור בינוני',
  bright_indirect: 'אור בהיר לא ישיר',
  direct: 'שמש ישירה',
}

export const HUMIDITY_LABELS: Record<string, string> = {
  dry: 'יבש',
  normal: 'רגיל',
  humid: 'לח',
}

export function wateringLabel(days: number) {
  return days === 1 ? 'השקיה כל יום' : `השקיה כל ${days} ימים`
}
