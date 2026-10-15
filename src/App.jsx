import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AMOUNT_RANGES, EMPTY_FILTERS, MONTHS, PERIODS, WEEKDAYS,
  filterExpenses, groupSum, iso, isSaving, monthLabel, shiftMonth, sum, unique, weekday,
} from './lib.js'
import './App.css'

const API = import.meta.env.VITE_SHEET_API_URL
const CHECK_MS = 10000
const FILTER_KEY = 'expense-filters'
const PIE_SLICES = 7 // series slots 1-7; everything else folds into "Other"
const PASSWORD_KEY = 'expense-password'

const num = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (v) => num.format(v)
const pct = (v) => `${(v * 100).toFixed(1)}%`
const niceDate = (d) => `${+d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`

const feedUrl = (password, check) => `${API}?key=${encodeURIComponent(password)}${check ? '&check=1' : ''}`

async function getJson(url) {
  const res = await fetch(url)
  return res.json().catch(() => { throw new Error(`the feed did not return JSON (HTTP ${res.status})`) })
}

// Loads the sheet on start and on Refresh. In between it only asks the feed for a
// small fingerprint, and reloads the rows when an entry was added, edited or deleted.
// A rejected password (e.g. changed in Apps Script) sends you back to the login.
function useSheet(password, onLocked) {
  const [data, setData] = useState({ rows: null, updated: null, error: null })
  const [busy, setBusy] = useState(false)
  const version = useRef(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const json = await getJson(feedUrl(password))
      if (json.error === 'unauthorized') return onLocked()
      if (!Array.isArray(json.rows)) throw new Error(json.error || 'unexpected response')
      version.current = json.version
      setData({ rows: json.rows, updated: new Date(), error: null })
    } catch (e) {
      setData((d) => ({ ...d, error: e.message }))
    } finally {
      setBusy(false)
    }
  }, [password, onLocked])

  const check = useCallback(async () => {
    try {
      const json = await getJson(feedUrl(password, true))
      if (json.error === 'unauthorized') onLocked()
      else if (json.version !== version.current) load()
      else setData((d) => (d.error ? { ...d, error: null } : d))
    } catch (e) {
      setData((d) => ({ ...d, error: e.message }))
    }
  }, [load, password, onLocked])

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') check() }
    const first = setTimeout(load, 0)
    const id = setInterval(tick, CHECK_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearTimeout(first); clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [load, check])

  return { ...data, busy, load }
}

function useFilters() {
  const [f, setF] = useState(() => {
    try { return { ...EMPTY_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY)) } } catch { return EMPTY_FILTERS }
  })
  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)) } catch { /* storage blocked */ } }, [f])
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
  const toggle = (k, v) => setF((p) => ({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] }))
  return { f, set, toggle, reset: () => setF(EMPTY_FILTERS) }
}

// index.html applies the saved or system theme before paint; this only flips it.
function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light')
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('theme', next) } catch { /* storage blocked */ }
    setTheme(next)
  }
  return [theme, flip]
}

// Colour follows the entity, not its rank in the current filter: slots are given by
// all-time totals, so filtering never repaints a category.
const colorMap = (groups) => new Map(groups.slice(0, PIE_SLICES).map((g, i) => [g.name, `var(--series-${i + 1})`]))

export default function App() {
  const [password, setPassword] = useState(() => { try { return localStorage.getItem(PASSWORD_KEY) } catch { return null } })
  const login = (pw) => { try { localStorage.setItem(PASSWORD_KEY, pw) } catch { /* storage blocked */ } setPassword(pw) }
  const lock = useCallback(() => { try { localStorage.removeItem(PASSWORD_KEY) } catch { /* storage blocked */ } setPassword(null) }, [])

  if (!API) return <Setup />
  if (!password) return <Login onLogin={login} />
  return <Dashboard password={password} onLock={lock} />
}

function Login({ onLogin }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const json = await getJson(feedUrl(pw, true))
      if (json.error) setError(json.error === 'unauthorized' ? 'Wrong password, please try again.' : json.error)
      else return onLogin(pw)
    } catch (x) {
      setError(`Can't reach the sheet: ${x.message}`)
    }
    setBusy(false)
  }
  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <span className="logo" aria-hidden="true"><Icon d={ICONS.wallet} /></span>
        <h1>Welcome Nihal,</h1>
        <label className="field">
          <span>Please enter your password</span>
          <input type="password" autoFocus autoComplete="current-password" value={pw}
            onChange={(e) => setPw(e.target.value)} aria-invalid={!!error} />
        </label>
        {error ? <p className="login-error" role="alert">{error}</p> : null}
        <button className="btn primary" disabled={busy || !pw}>{busy ? 'Checking…' : 'Unlock'}</button>
      </form>
    </div>
  )
}

function Dashboard({ password, onLock }) {
  const { rows, updated, error, busy, load } = useSheet(password, onLock)
  const { f, set, toggle, reset } = useFilters()
  const [theme, flipTheme] = useTheme()
  const today = iso(new Date())

  const view = useMemo(() => {
    if (!rows) return null
    const expenses = rows.filter((r) => !isSaving(r))
    const savings = rows.filter(isSaving)
    const shown = filterExpenses(rows, f, today)
    const ym = today.slice(0, 7)
    const allByCategory = groupSum(expenses, (r) => r.category)
    const allByPayment = groupSum(expenses, (r) => r.payment)
    return {
      shown,
      savings,
      total: sum(shown),
      days: unique(shown.map((r) => r.date)).length,
      byCategory: groupSum(shown, (r) => r.category),
      byPayment: groupSum(shown, (r) => r.payment),
      catColors: colorMap(allByCategory),
      payColors: colorMap(allByPayment),
      thisMonth: sum(expenses.filter((r) => r.date.startsWith(ym))),
      lastMonth: sum(expenses.filter((r) => r.date.startsWith(shiftMonth(ym, -1)))),
      years: unique(rows.map((r) => +r.date.slice(0, 4))).sort(),
      categories: allByCategory.map((g) => g.name).filter(Boolean),
      payments: allByPayment.map((g) => g.name),
    }
  }, [rows, f, today])

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true"><Icon d={ICONS.wallet} /></span>
          <div>
            <h1>Expenses</h1>
            <p className="muted">Savings are tracked separately, never counted as spending</p>
          </div>
        </div>
        <div className="actions">
          <span className={'status' + (error ? ' bad' : '')} title={error ? `Can't refresh: ${error}` : undefined}>
            <span className="dot" aria-hidden="true" />
            {error ? 'Offline' : updated ? `Live · ${updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Loading…'}
          </span>
          <button className="icon-btn" onClick={load} disabled={busy} aria-label="Refresh" title="Refresh">
            <Icon d={ICONS.refresh} className={busy ? 'spin' : ''} />
          </button>
          <button className="icon-btn" onClick={flipTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`${theme === 'dark' ? 'Light' : 'Dark'} theme`}>
            <Icon d={theme === 'dark' ? ICONS.sun : ICONS.moon} />
          </button>
          <button className="icon-btn" onClick={onLock} aria-label="Lock" title="Lock (asks for the password again)">
            <Icon d={ICONS.lock} />
          </button>
        </div>
      </header>

      {!view ? (
        <div className="card empty">
          {error ? 'Could not load the sheet. Check the feed URL and its access setting.' : <><span className="loader" /> Loading your expenses…</>}
        </div>
      ) : (
        <>
          <Filters f={f} set={set} toggle={toggle} reset={reset} view={view} />
          <Kpis view={view} />

          <section className="grid">
            <Panel title="By category" note="tap a slice or row to filter">
              <Donut groups={view.byCategory} colors={view.catColors} selected={f.categories} onPick={(n) => toggle('categories', n)} />
            </Panel>
            <Panel title="By payment method" note="tap a slice or row to filter">
              <Donut groups={view.byPayment} colors={view.payColors} selected={f.payments} onPick={(n) => toggle('payments', n)} />
            </Panel>
            <Panel title="Spending by month" note="last 12 months in the filter">
              <Bars data={groupSum(view.shown, (r) => r.date.slice(0, 7))
                .sort((a, b) => a.name.localeCompare(b.name)).slice(-12)
                .map((g) => ({ key: g.name, label: monthLabel(g.name), value: g.total, sub: `${g.count} transactions` }))} />
            </Panel>
            <Panel title="Spending by day">
              <Bars data={groupSum(view.shown, (r) => r.date)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((g) => ({ key: g.name, label: niceDate(g.name).slice(0, -5), title: niceDate(g.name), value: g.total, sub: `${g.count} transactions` }))} />
            </Panel>
            <Panel title="Latest 10 expenses">
              <TxnList rows={[...view.shown].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)} colors={view.catColors} />
            </Panel>
            <Panel title="Largest 10 expenses">
              <TxnList rows={[...view.shown].sort((a, b) => b.amount - a.amount).slice(0, 10)} colors={view.catColors} />
            </Panel>
          </section>

          <Savings rows={view.savings} today={today} />
          <MoreAnalysis view={view} />
        </>
      )}
    </div>
  )
}

function Setup() {
  return (
    <div className="page">
      <div className="card setup">
        <h1>Connect your sheet</h1>
        <ol>
          <li>Open the sheet, then Extensions › Apps Script, and add the file <code>apps-script/api.gs</code> from this project.</li>
          <li>Project Settings › Script Properties: add <code>DASH_PASSWORD</code> with your password.</li>
          <li>Deploy › New deployment › Web app. Execute as <b>Me</b>, access <b>Anyone</b>. Copy the URL ending in <code>/exec</code>.</li>
          <li>Create <code>expense-app/.env.local</code> with <code>VITE_SHEET_API_URL=&lt;that URL&gt;</code> and restart <code>npm run dev</code>.</li>
        </ol>
      </div>
    </div>
  )
}

/* ---------- icons ---------- */

const ICONS = {
  wallet: 'M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2Zm13 6h.01',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  sun: 'M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z',
  search: 'm21 21-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  sliders: 'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4M16 16v4',
  x: 'M18 6 6 18M6 6l12 12',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
}

function Icon({ d, className = '' }) {
  return (
    <svg className={'icon ' + className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  )
}

function SearchBox({ value, onChange, placeholder, label, small }) {
  return (
    <label className={'search' + (small ? ' small' : '')}>
      <Icon d={ICONS.search} />
      <input type="search" value={value} placeholder={placeholder} aria-label={label || placeholder}
        onChange={(e) => onChange(e.target.value)} />
      {value ? <button type="button" className="clear" onClick={() => onChange('')} aria-label="Clear search"><Icon d={ICONS.x} /></button> : null}
    </label>
  )
}

/* ---------- filters ---------- */

function Filters({ f, set, toggle, reset, view }) {
  const dlg = useRef(null)
  const datesChosen = f.months.length || f.years.length || f.from || f.to
  const pills = [
    ...f.months.map((m) => [`m${m}`, MONTHS[m - 1], () => toggle('months', m)]),
    ...f.years.map((y) => [`y${y}`, y, () => toggle('years', y)]),
    ...f.categories.map((c) => [`c${c}`, c, () => toggle('categories', c)]),
    ...f.payments.map((p) => [`p${p}`, p, () => toggle('payments', p)]),
    f.from && ['from', `From ${niceDate(f.from)}`, () => set('from', '')],
    f.to && ['to', `To ${niceDate(f.to)}`, () => set('to', '')],
    f.min !== '' && ['min', `Min ${f.min}`, () => set('min', '')],
    f.max !== '' && ['max', `Max ${f.max}`, () => set('max', '')],
  ].filter(Boolean)
  const close = () => dlg.current.close()

  return (
    <section className="toolbar" aria-label="Filters">
      <div className="toolbar-row">
        <SearchBox value={f.search} onChange={(v) => set('search', v)} placeholder="Search remarks, categories, payments…" label="Search expenses" />
        <button className="btn" onClick={() => dlg.current.showModal()}>
          <Icon d={ICONS.sliders} /><span className="btn-text">Filters</span>
          {pills.length ? <span className="badge">{pills.length}</span> : null}
        </button>
      </div>

      <div className="segmented" role="group" aria-label="Quick period">
        {PERIODS.map((p) => (
          <button key={p} className={f.period === p && !datesChosen ? 'on' : ''}
            aria-pressed={f.period === p && !datesChosen}
            onClick={() => { set('period', p); set('months', []); set('years', []); set('from', ''); set('to', '') }}>{p}</button>
        ))}
      </div>

      {pills.length || f.search ? (
        <div className="pills">
          {pills.map(([k, text, off]) => (
            <button key={k} className="pill" onClick={off} aria-label={`Remove filter ${text}`}>{text}<Icon d={ICONS.x} /></button>
          ))}
          <button className="link" onClick={reset}>Clear all</button>
        </div>
      ) : null}

      <dialog ref={dlg} className="sheet" aria-label="Filters" onClick={(e) => { if (e.target === dlg.current) close() }}>
        <div className="sheet-inner">
          <div className="sheet-head">
            <h2>Filters</h2>
            <button className="icon-btn" onClick={close} aria-label="Close filters"><Icon d={ICONS.x} /></button>
          </div>
          <div className="sheet-body">
            {datesChosen ? <p className="hint">Chosen months, years or dates override the quick period.</p> : null}
            <FilterGroup title="Date range">
              <div className="pair">
                <Field label="From"><input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field>
                <Field label="To"><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></Field>
              </div>
            </FilterGroup>
            <FilterGroup title="Amount">
              <div className="pair">
                <Field label="Min"><input type="number" inputMode="decimal" placeholder="0" value={f.min} onChange={(e) => set('min', e.target.value)} /></Field>
                <Field label="Max"><input type="number" inputMode="decimal" placeholder="Any" value={f.max} onChange={(e) => set('max', e.target.value)} /></Field>
              </div>
            </FilterGroup>
            <ChipGroup title="Month" items={MONTHS.map((m, i) => [i + 1, m])} selected={f.months} onPick={(v) => toggle('months', v)} />
            <ChipGroup title="Year" items={view.years.map((y) => [y, y])} selected={f.years} onPick={(v) => toggle('years', v)} />
            <ChipGroup title="Category" items={view.categories.map((c) => [c, c])} selected={f.categories}
              onPick={(v) => toggle('categories', v)} colors={view.catColors} searchable />
            <ChipGroup title="Payment" items={view.payments.map((p) => [p, p])} selected={f.payments}
              onPick={(v) => toggle('payments', v)} colors={view.payColors} searchable />
          </div>
          <div className="sheet-foot">
            <button className="btn" onClick={reset}>Reset all</button>
            <button className="btn primary" onClick={close}>Show {view.shown.length} expense{view.shown.length === 1 ? '' : 's'}</button>
          </div>
        </div>
      </dialog>
    </section>
  )
}

function FilterGroup({ title, children }) {
  return <div className="fgroup"><span className="label">{title}</span>{children}</div>
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function ChipGroup({ title, items, selected, onPick, colors, searchable }) {
  const [q, setQ] = useState('')
  const shown = q ? items.filter(([, text]) => String(text).toLowerCase().includes(q.toLowerCase())) : items
  return (
    <div className="fgroup" role="group" aria-label={title}>
      <span className="label">{title}{selected.length ? <em> · {selected.length} picked</em> : null}</span>
      {searchable && items.length > 6 ? <SearchBox value={q} onChange={setQ} placeholder={`Find ${title.toLowerCase()}…`} small /> : null}
      <div className="chips">
        {shown.map(([v, text]) => (
          <button key={v} className={'chip' + (selected.includes(v) ? ' on' : '')}
            aria-pressed={selected.includes(v)} onClick={() => onPick(v)}>
            {colors ? <i className="swatch" style={{ background: colors.get(v) || 'var(--series-other)' }} /> : null}{text}
          </button>
        ))}
        {!shown.length ? <span className="hint">No match</span> : null}
      </div>
    </div>
  )
}

/* ---------- summary cards ---------- */

function Kpis({ view }) {
  const top = view.byCategory[0]
  const change = view.lastMonth ? view.thisMonth / view.lastMonth - 1 : null
  const saved = sum(view.savings)
  return (
    <section className="kpis">
      <Kpi label="Total spent" value={money(view.total)} note={`${view.shown.length} transactions`} accent />
      <Kpi label="Daily average" value={money(view.days ? view.total / view.days : 0)} note={`over ${view.days} days with spending`} />
      <Kpi label="Top category" value={top ? top.name : '–'}
        note={top ? `${money(top.total)} · ${pct(top.total / view.total)} of spending` : 'No spending in this view'} />
      <Kpi label="This month vs last"
        value={change === null ? '–' : <span className={change > 0 ? 'up' : 'down'}>{change > 0 ? '▲' : '▼'} {pct(Math.abs(change))}</span>}
        note={`${money(view.thisMonth)} now · ${money(view.lastMonth)} last month`} />
      <Kpi label="Savings balance" value={money(saved)} note="all time" savings />
    </section>
  )
}

function Kpi({ label, value, note, accent, savings }) {
  return (
    <div className={'card kpi' + (accent ? ' accent' : '') + (savings ? ' savings' : '')}>
      <span className="label">{label}</span>
      <strong>{value}</strong>
      <span className="note">{note}</span>
    </div>
  )
}

/* ---------- charts and tables ---------- */

function Panel({ title, note, children }) {
  return (
    <div className="card panel">
      <h2>{title}{note ? <small>{note}</small> : null}</h2>
      {children}
    </div>
  )
}

// Donut with a legend that doubles as the table view. Groups beyond the colour slots
// fold into a grey "Other" slice, which is not clickable.
function Donut({ groups, colors, selected, onPick }) {
  const [hover, setHover] = useState(null)
  const main = groups.filter((g) => colors.has(g.name) && g.total > 0)
  const rest = groups.filter((g) => !colors.has(g.name) && g.total > 0)
  const slices = rest.length
    ? [...main, { name: 'Other', other: true, total: sum(rest.map((g) => ({ amount: g.total }))), count: rest.reduce((n, g) => n + g.count, 0) }]
    : main
  const total = sum(slices.map((g) => ({ amount: g.total })))
  if (!total) return <p className="empty">No data for these filters</p>

  const R = 70, C = 2 * Math.PI * R, GAP = slices.length > 1 ? 2 : 0
  const arcs = slices.reduce((out, g) => {
    const prev = out[out.length - 1]
    return [...out, { ...g, at: prev ? prev.at + prev.len : 0, len: (g.total / total) * C }]
  }, [])
  const colorOf = (g) => (g.other ? 'var(--series-other)' : colors.get(g.name))
  const h = arcs.find((a) => a.name === hover)
  const pick = (g) => { if (!g.other) onPick(g.name) }

  return (
    <div className="donut">
      <div className="donut-plot" onPointerLeave={() => setHover(null)}>
        <svg viewBox="0 0 180 180" role="img" aria-label="Share of spending">
          <circle cx="90" cy="90" r={R} fill="none" stroke="var(--grid)" strokeWidth="22" />
          {arcs.map((a) => (
            <circle key={a.name} cx="90" cy="90" r={R} fill="none" stroke={colorOf(a)}
              strokeWidth={hover === a.name ? 28 : 22}
              strokeDasharray={`${Math.max(a.len - GAP, 0.5)} ${C}`} strokeDashoffset={-a.at}
              transform="rotate(-90 90 90)" className={'slice' + (selected.length && !selected.includes(a.name) && !a.other ? ' dim' : '')}
              onPointerEnter={() => setHover(a.name)} onClick={() => pick(a)} />
          ))}
        </svg>
        <div className="donut-center">
          <span className="label">{h ? h.name : 'Total'}</span>
          <strong>{money(h ? h.total : total)}</strong>
          <span className="note">{h ? `${pct(h.total / total)} · ${h.count} txns` : `${slices.length} groups`}</span>
        </div>
      </div>
      <ul className="legend">
        {arcs.map((a) => (
          <li key={a.name}>
            <button className={selected.includes(a.name) ? 'on' : ''} disabled={a.other} aria-pressed={selected.includes(a.name)}
              onPointerEnter={() => setHover(a.name)} onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(a.name)} onBlur={() => setHover(null)} onClick={() => pick(a)}>
              <i className="swatch" style={{ background: colorOf(a) }} />
              <span className="name">{a.name || '(blank)'}</span>
              <span className="pct">{pct(a.total / total)}</span>
              <span className="amt">{money(a.total)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Column chart; hovered/tapped bar is read out above the plot. Handles negative values.
function Bars({ data, color = 'var(--series-1)' }) {
  const [active, setActive] = useState(null)
  if (!data.length) return <p className="empty">No data for these filters</p>
  const max = Math.max(0, ...data.map((d) => d.value))
  const min = Math.min(0, ...data.map((d) => d.value))
  const i = active !== null && active < data.length ? active : data.length - 1
  const a = data[i]
  const every = Math.ceil(data.length / 8)
  return (
    <div className="bars">
      <p className="readout"><b>{money(a.value)}</b> {a.title || a.label}{a.sub ? <span> · {a.sub}</span> : null}</p>
      <div className="plot" onPointerLeave={() => setActive(null)}>
        {data.map((d, k) => (
          <button key={d.key} className={'col' + (k === i ? ' on' : '')} style={{ '--c': color }}
            onPointerEnter={() => setActive(k)} onFocus={() => setActive(k)} onClick={() => setActive(k)}
            aria-label={`${d.title || d.label}: ${money(d.value)}`}>
            <span className="up" style={{ flex: max }}><i style={{ height: `${d.value > 0 ? (d.value / max) * 100 : 0}%` }} /></span>
            <span className="down" style={{ flex: -min }}><i className="neg" style={{ height: `${d.value < 0 ? (d.value / min) * 100 : 0}%` }} /></span>
            <span className="x">{k % every === 0 || k === data.length - 1 ? d.label : ''}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// Ranked rows with share bars.
function Breakdown({ groups, total, color = 'var(--series-1)' }) {
  if (!groups.length) return <p className="empty">No data for these filters</p>
  const max = Math.max(...groups.map((g) => g.total), 0) || 1
  return (
    <div className="breakdown">
      {groups.map((g) => (
        <div key={g.name} className="brow">
          <span className="name">{g.name || '(blank)'}</span>
          <span className="amt">{money(g.total)}</span>
          <span className="meta">{g.count} · {total ? pct(g.total / total) : '–'}</span>
          <span className="track"><i style={{ width: `${(Math.max(g.total, 0) / max) * 100}%`, background: color }} /></span>
        </div>
      ))}
    </div>
  )
}

function TxnList({ rows, signed, colors }) {
  if (!rows.length) return <p className="empty">Nothing here yet</p>
  return (
    <ul className="txns">
      {rows.map((r, k) => (
        <li key={k}>
          <span className="avatar" style={{ '--c': signed ? 'var(--series-save)' : colors?.get(r.category) || 'var(--series-other)' }} aria-hidden="true">
            {(r.category || '?').slice(0, 1).toUpperCase()}
          </span>
          <div>
            <span className="name">{r.remarks || r.category}</span>
            <span className="meta">{niceDate(r.date)} · {signed ? r.payment : `${r.category} · ${r.payment}`}</span>
          </div>
          <span className={'amt' + (signed ? (r.amount < 0 ? ' down-neg' : ' up-pos') : '')}>
            {signed && r.amount > 0 ? '+' : ''}{money(r.amount)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ---------- savings (all time, never filtered) ---------- */

function Savings({ rows, today }) {
  const added = sum(rows.filter((r) => r.amount > 0))
  const thisMonth = sum(rows.filter((r) => r.date.startsWith(today.slice(0, 7))))
  const byMonth = groupSum(rows, (r) => r.date.slice(0, 7)).sort((a, b) => a.name.localeCompare(b.name))
  const data = byMonth.map((g, k) => ({
    key: g.name, label: monthLabel(g.name), value: g.total,
    sub: `balance ${money(sum(byMonth.slice(0, k + 1).map((x) => ({ amount: x.total }))))}`,
  }))
  return (
    <section className="savings-section">
      <h2 className="section">Savings <small>all time · negative amounts are withdrawals</small></h2>
      <div className="kpis three">
        <Kpi label="Balance" value={money(sum(rows))} note={`${thisMonth >= 0 ? '+' : ''}${money(thisMonth)} this month`} savings />
        <Kpi label="Total added" value={money(added)} note={`${rows.filter((r) => r.amount > 0).length} deposits`} />
        <Kpi label="Total withdrawn" value={money(-sum(rows.filter((r) => r.amount < 0)))} note={`${rows.filter((r) => r.amount < 0).length} withdrawals`} />
      </div>
      <div className="grid">
        <Panel title="Saved per month" note="tap a bar for the running balance">
          <Bars data={data} color="var(--series-save)" />
        </Panel>
        <Panel title="Latest savings entries">
          <TxnList rows={[...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)} signed />
        </Panel>
      </div>
    </section>
  )
}

/* ---------- more analysis ---------- */

function MoreAnalysis({ view }) {
  const { shown, total } = view
  const byDay = WEEKDAYS.map((name, i) => {
    const r = shown.filter((x) => weekday(x.date) === i)
    return { name, total: sum(r), count: r.length }
  })
  const byRange = AMOUNT_RANGES.map(([name, lo, hi]) => {
    const r = shown.filter((x) => x.amount >= lo && x.amount < hi)
    return { name, total: sum(r), count: r.length }
  })
  const months = unique(shown.map((r) => r.date.slice(0, 7))).sort()
  const cell = (cat, ym) => sum(shown.filter((r) => r.category === cat && r.date.startsWith(ym)))
  return (
    <details className="more">
      <summary className="section">More analysis</summary>
      <div className="grid">
        <Panel title="By day of week"><Breakdown groups={byDay} total={total} color="var(--series-3)" /></Panel>
        <Panel title="By amount range"><Breakdown groups={byRange} total={total} color="var(--series-4)" /></Panel>
        <Panel title="Top 10 remarks" note="where the money goes">
          <Breakdown groups={groupSum(shown.filter((r) => r.remarks), (r) => r.remarks).slice(0, 10)} total={total} color="var(--series-7)" />
        </Panel>
        <Panel title="Category by month">
          {months.length ? (
            <div className="scroll">
              <table>
                <thead><tr><th>Category</th>{months.map((m) => <th key={m}>{monthLabel(m)}</th>)}</tr></thead>
                <tbody>
                  {view.byCategory.map((g) => (
                    <tr key={g.name}><th>{g.name}</th>{months.map((m) => { const v = cell(g.name, m); return <td key={m}>{v ? money(v) : ''}</td> })}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty">No data for these filters</p>}
        </Panel>
      </div>
    </details>
  )
}
