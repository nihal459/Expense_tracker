// Pure data logic for the dashboard; mirrors the filters of the Sheets dashboard.

export const PERIODS = ['This month', 'Last month', 'Last 7 days', 'Last 30 days', 'This year', 'All time']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const AMOUNT_RANGES = [
  ['Under 10', 0, 10], ['10 to 50', 10, 50], ['50 to 100', 50, 100],
  ['100 to 500', 100, 500], ['500 to 1,000', 500, 1000], ['Over 1,000', 1000, Infinity],
]
export const EMPTY_FILTERS = {
  period: 'This month', from: '', to: '', min: '', max: '', search: '',
  months: [], years: [], categories: [], payments: [],
}

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (date, n) => { const d = new Date(date + 'T00:00'); d.setDate(d.getDate() + n); return iso(d) }
export const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); return iso(new Date(y, m - 1 + n, 1)).slice(0, 7) }
export const monthLabel = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`

export const isSaving = (r) => r.category.toLowerCase() === 'savings'

export function inPeriod(date, period, today) {
  const ym = today.slice(0, 7)
  switch (period) {
    case 'This month': return date.startsWith(ym)
    case 'Last month': return date.startsWith(shiftMonth(ym, -1))
    case 'Last 7 days': return date > addDays(today, -7) && date <= today
    case 'Last 30 days': return date > addDays(today, -30) && date <= today
    case 'This year': return date.startsWith(today.slice(0, 4))
    default: return true
  }
}

// Expense rows (savings excluded) that pass every filter. Picking months/years or
// typing dates overrides the quick period, like the sheet.
export function filterExpenses(rows, f, today = iso(new Date())) {
  const datesChosen = f.months.length || f.years.length || f.from || f.to
  const q = f.search.trim().toLowerCase()
  return rows.filter((r) => !isSaving(r)
    && (datesChosen || inPeriod(r.date, f.period, today))
    && (!f.months.length || f.months.includes(+r.date.slice(5, 7)))
    && (!f.years.length || f.years.includes(+r.date.slice(0, 4)))
    && (!f.categories.length || f.categories.includes(r.category))
    && (!f.payments.length || f.payments.includes(r.payment))
    && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to)
    && (f.min === '' || r.amount >= +f.min) && (f.max === '' || r.amount <= +f.max)
    && (!q || `${r.remarks} ${r.category} ${r.payment}`.toLowerCase().includes(q)))
}

// [{ name, total, count }] sorted by total, largest first.
export function groupSum(rows, keyFn) {
  const m = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    const g = m.get(k) || { name: k, total: 0, count: 0 }
    g.total += r.amount
    g.count++
    m.set(k, g)
  }
  return [...m.values()].sort((a, b) => b.total - a.total)
}

export const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0)
export const unique = (values) => [...new Set(values)]
export const weekday = (date) => (new Date(date + 'T00:00').getDay() + 6) % 7
