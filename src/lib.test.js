// Run: npm test
import assert from 'node:assert/strict'
import { EMPTY_FILTERS, filterExpenses, groupSum, inPeriod, shiftMonth, weekday } from './lib.js'

const today = '2026-10-15'
const rows = [
  { date: '2026-10-01', category: 'Food', amount: 20, payment: 'Card', remarks: 'Lunch' },
  { date: '2026-10-10', category: 'Savings', amount: 500, payment: 'Bank', remarks: '' },
  { date: '2026-09-30', category: 'Grocery', amount: 80, payment: 'Cash', remarks: 'Market' },
  { date: '2025-09-05', category: 'Food', amount: 5, payment: 'Card', remarks: 'coffee' },
]
const f = (o) => filterExpenses(rows, { ...EMPTY_FILTERS, ...o }, today).map((r) => r.date)

assert.deepEqual(f({}), ['2026-10-01'], 'this month, savings excluded')
assert.deepEqual(f({ period: 'Last month' }), ['2026-09-30'])
assert.deepEqual(f({ months: [9] }), ['2026-09-30', '2025-09-05'], 'month pick overrides period')
assert.deepEqual(f({ months: [9], years: [2025] }), ['2025-09-05'])
assert.deepEqual(f({ period: 'All time', search: 'COFF' }), ['2025-09-05'])
assert.deepEqual(f({ period: 'All time', search: 'cash' }), ['2026-09-30'], 'search matches payment')
assert.deepEqual(f({ period: 'All time', min: '10', max: '50' }), ['2026-10-01'])
assert.deepEqual(f({ from: '2026-09-01', categories: ['Grocery'] }), ['2026-09-30'])
assert.equal(inPeriod('2026-10-08', 'Last 7 days', today), false)
assert.equal(inPeriod('2026-10-09', 'Last 7 days', today), true)
assert.equal(shiftMonth('2026-01', -1), '2025-12')
assert.equal(weekday('2026-10-12'), 0, 'Monday')
assert.deepEqual(groupSum(rows, (r) => r.payment)[0], { name: 'Bank', total: 500, count: 1 })
console.log('lib tests passed')
