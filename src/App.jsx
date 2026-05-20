import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import './App.css'

const STORAGE_KEY = 'presupuesto-data:v2'
const currency = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
})

const getToday = () => new Date().toISOString().slice(0, 10)
const BANK_DEFAULT = {
  accountMovements: [],
  cardMovements: [],
  accountAvailableBalance: null,
  monthlyInstallmentsDue: 0,
  lastAccountImportAt: '',
  lastCardImportAt: '',
}

const normalizeHeader = (value) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')

const parseAmount = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }
  if (value === null || value === undefined) return 0

  let text = String(value).trim()
  if (!text) return 0
  text = text.replace(/[^\d,.-]/g, '')

  if (text.includes(',') && text.includes('.')) {
    text = text.replace(/\./g, '').replace(',', '.')
  } else if (text.includes(',')) {
    text = text.replace(',', '.')
  }

  const parsed = Number.parseFloat(text)
  if (!Number.isFinite(parsed)) return 0
  return Math.round(parsed)
}

const parseExcelDate = (value) => {
  if (value instanceof Date) return value
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return new Date(parsed.y, parsed.m - 1, parsed.d)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parts = trimmed.split(/[/-]/)
    if (parts.length === 3) {
      const [day, month, year] = parts.map((part) => Number(part))
      if (year && month && day) {
        return new Date(year, month - 1, day)
      }
    }
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

const formatDate = (value) => {
  const date = parseExcelDate(value)
  if (!date) return ''
  return date.toISOString().slice(0, 10)
}

const formatDateTime = (value) => {
  if (!value) return 'Sin importar'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sin importar'
  return date.toLocaleString('es-CL')
}

const loadInitialData = () => {
  if (typeof window === 'undefined') {
    return { categories: [], expenses: [], bankData: BANK_DEFAULT, error: '', canPersist: true }
  }

  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) {
    return { categories: [], expenses: [], bankData: BANK_DEFAULT, error: '', canPersist: true }
  }

  try {
    const parsed = JSON.parse(stored)
    const bankData = parsed.bankData && typeof parsed.bankData === 'object'
      ? {
          ...BANK_DEFAULT,
          ...parsed.bankData,
          accountMovements: Array.isArray(parsed.bankData.accountMovements)
            ? parsed.bankData.accountMovements
            : [],
          cardMovements: Array.isArray(parsed.bankData.cardMovements)
            ? parsed.bankData.cardMovements
            : [],
        }
      : BANK_DEFAULT
    return {
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      bankData,
      error: '',
      canPersist: true,
    }
  } catch {
    return {
      categories: [],
      expenses: [],
      bankData: BANK_DEFAULT,
      error: 'No se pudo leer el almacenamiento local. Intenta importar un respaldo.',
      canPersist: false,
    }
  }
}

function App() {
  const [initialData] = useState(loadInitialData)
  const [categories, setCategories] = useState(initialData.categories)
  const [expenses, setExpenses] = useState(initialData.expenses)
  const [bankData, setBankData] = useState(initialData.bankData)
  const [categoryForm, setCategoryForm] = useState({ name: '', budget: '' })
  const [expenseForm, setExpenseForm] = useState({
    date: getToday(),
    categoryId: '',
    amount: '',
    note: '',
  })
  const [error, setError] = useState(initialData.error)
  const [canPersist, setCanPersist] = useState(initialData.canPersist)

  useEffect(() => {
    if (!canPersist) return
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, categories, expenses, bankData })
    )
  }, [categories, expenses, bankData, canPersist])

  const spentByCategory = useMemo(() => {
    const totals = new Map()
    for (const expense of expenses) {
      const current = totals.get(expense.categoryId) ?? 0
      totals.set(expense.categoryId, current + expense.amount)
    }
    return totals
  }, [expenses])

  const totalBudget = useMemo(
    () => categories.reduce((sum, category) => sum + category.monthlyBudget, 0),
    [categories]
  )
  const totalSpent = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  )
  const remaining = totalBudget - totalSpent
  const accountMovements = bankData.accountMovements
  const cardMovements = bankData.cardMovements

  const accountBalance = useMemo(() => {
    if (Number.isFinite(bankData.accountAvailableBalance)) {
      return bankData.accountAvailableBalance
    }
    if (accountMovements.length === 0) return 0
    const withDate = accountMovements.filter((item) => item.date)
    const sorted = [...(withDate.length ? withDate : accountMovements)].sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || ''))
    )
    const latest = sorted[sorted.length - 1]
    return Number(latest?.balance) || 0
  }, [accountMovements, bankData.accountAvailableBalance])

  const cardUnbilledTotal = useMemo(
    () => cardMovements.reduce((sum, item) => sum + item.amount, 0),
    [cardMovements]
  )
  const totalCardDue = cardUnbilledTotal + (bankData.monthlyInstallmentsDue || 0)

  const updateBankData = (updater) => {
    setBankData((prev) => (typeof updater === 'function' ? updater(prev) : updater))
    setCanPersist(true)
  }

  const ACCOUNT_HEADER_MAP = {
    fecha: 'date',
    descripcion: 'detail',
    detalle: 'detail',
    canalosucursal: 'channel',
    cargosclp: 'debit',
    cargos: 'debit',
    abonosclp: 'credit',
    abonos: 'credit',
    saldoclp: 'balance',
    saldo: 'balance',
  }
  const CARD_HEADER_MAP = {
    fecha: 'date',
    tipodetarjeta: 'cardType',
    descripcion: 'description',
    ciudad: 'city',
    cuotas: 'installments',
    monto: 'amount',
  }

  const parseWorkbook = async (file) => {
    const data = await file.arrayBuffer()
    const workbook = XLSX.read(data, { type: 'array', cellDates: true })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return []
    const sheet = workbook.Sheets[sheetName]
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  }

  const findHeaderRowIndex = (rows, requiredHeaders) =>
    rows.findIndex((row) => {
      const normalized = row.map((cell) => normalizeHeader(cell))
      return requiredHeaders.every((header) => normalized.includes(header))
    })

  const buildColumnIndexMap = (headerRow, headerMap) => {
    const map = {}
    headerRow.forEach((cell, index) => {
      const normalized = normalizeHeader(cell)
      const targetKey = headerMap[normalized]
      if (targetKey && map[targetKey] === undefined) {
        map[targetKey] = index
      }
    })
    return map
  }

  const findSaldoDisponible = (rows) => {
    const labelIndex = rows.findIndex((row) =>
      row.some((cell) => normalizeHeader(cell) === 'saldodisponible')
    )
    if (labelIndex === -1) return null
    const labelRow = rows[labelIndex]
    const valueRow = rows[labelIndex + 1]
    if (!valueRow) return null
    const columnIndex = labelRow.findIndex(
      (cell) => normalizeHeader(cell) === 'saldodisponible'
    )
    if (columnIndex === -1) return null
    const amount = parseAmount(valueRow[columnIndex])
    return Number.isFinite(amount) ? amount : null
  }

  const handleAccountImport = async (event) => {
    setError('')
    const file = event.target.files?.[0]
    if (!file) return

    let rows
    try {
      rows = await parseWorkbook(file)
    } catch {
      setError('No se pudo leer el archivo de cuenta corriente.')
      event.target.value = ''
      return
    }

    const headerIndex = findHeaderRowIndex(rows, [
      'fecha',
      'descripcion',
      'cargosclp',
      'abonosclp',
      'saldoclp',
    ])
    if (headerIndex === -1) {
      setError('No se encontro la fila de cabecera en la cartola.')
      event.target.value = ''
      return
    }

    const columnMap = buildColumnIndexMap(rows[headerIndex], ACCOUNT_HEADER_MAP)
    const requiredFields = ['date', 'detail', 'balance']
    const missing = requiredFields.filter((field) => columnMap[field] === undefined)
    if (missing.length > 0) {
      setError(
        `Faltan columnas esperadas en cuenta corriente: ${missing.join(', ')}.`
      )
      event.target.value = ''
      return
    }

    const mapped = rows
      .slice(headerIndex + 1)
      .map((row) => {
        return {
          id: crypto.randomUUID(),
          date: formatDate(row[columnMap.date]),
          detail: String(row[columnMap.detail] ?? '').trim(),
          debit: parseAmount(row[columnMap.debit]),
          credit: parseAmount(row[columnMap.credit]),
          balance: parseAmount(row[columnMap.balance]),
          channel: String(row[columnMap.channel] ?? '').trim(),
        }
      })
      .filter(
        (item) =>
          item.date ||
          item.detail ||
          item.debit ||
          item.credit ||
          item.balance
      )

    const availableBalance = findSaldoDisponible(rows)
    updateBankData((prev) => ({
      ...prev,
      accountMovements: mapped,
      accountAvailableBalance:
        availableBalance !== null ? availableBalance : prev.accountAvailableBalance,
      lastAccountImportAt: new Date().toISOString(),
    }))
    event.target.value = ''
  }

  const handleCardImport = async (event) => {
    setError('')
    const file = event.target.files?.[0]
    if (!file) return

    let rows
    try {
      rows = await parseWorkbook(file)
    } catch {
      setError('No se pudo leer el archivo de tarjeta de credito.')
      event.target.value = ''
      return
    }

    const headerIndex = findHeaderRowIndex(rows, ['fecha', 'descripcion', 'monto'])
    if (headerIndex === -1) {
      setError('No se encontro la fila de cabecera en el archivo de tarjeta.')
      event.target.value = ''
      return
    }

    const columnMap = buildColumnIndexMap(rows[headerIndex], CARD_HEADER_MAP)
    const requiredFields = ['date', 'description', 'amount']
    const missing = requiredFields.filter((field) => columnMap[field] === undefined)
    if (missing.length > 0) {
      setError(
        `Faltan columnas esperadas en tarjeta de credito: ${missing.join(', ')}.`
      )
      event.target.value = ''
      return
    }

    const mapped = rows
      .slice(headerIndex + 1)
      .map((row) => {
        return {
          id: crypto.randomUUID(),
          date: formatDate(row[columnMap.date]),
          cardType: String(row[columnMap.cardType] ?? '').trim(),
          description: String(row[columnMap.description] ?? '').trim(),
          city: String(row[columnMap.city] ?? '').trim(),
          installments: String(row[columnMap.installments] ?? '').trim(),
          amount: parseAmount(row[columnMap.amount]),
        }
      })
      .filter((item) => item.date || item.description || item.amount)

    updateBankData((prev) => ({
      ...prev,
      cardMovements: mapped,
      lastCardImportAt: new Date().toISOString(),
    }))
    event.target.value = ''
  }

  const handleMonthlyInstallmentsChange = (event) => {
    const amount = parseAmount(event.target.value)
    updateBankData((prev) => ({
      ...prev,
      monthlyInstallmentsDue: amount,
    }))
  }

  const handleAddCategory = (event) => {
    event.preventDefault()
    setError('')

    const name = categoryForm.name.trim()
    const budget = Number(categoryForm.budget)

    if (!name) {
      setError('El nombre de la categoría es obligatorio.')
      return
    }
    if (!Number.isFinite(budget) || budget < 0) {
      setError('El presupuesto debe ser un número mayor o igual a 0.')
      return
    }

    const newCategory = {
      id: crypto.randomUUID(),
      name,
      monthlyBudget: budget,
    }

    setCategories((prev) => [...prev, newCategory])
    setCanPersist(true)
    setCategoryForm({ name: '', budget: '' })
  }

  const handleDeleteCategory = (categoryId) => {
    setCategories((prev) => prev.filter((category) => category.id !== categoryId))
    setExpenses((prev) => prev.filter((expense) => expense.categoryId !== categoryId))
  }

  const selectedCategoryId = expenseForm.categoryId || categories[0]?.id || ''

  const handleAddExpense = (event) => {
    event.preventDefault()
    setError('')

    if (categories.length === 0) {
      setError('Crea al menos una categoría antes de registrar gastos.')
      return
    }

    const amount = Number(expenseForm.amount)

    if (!selectedCategoryId) {
      setError('Selecciona una categoría para el gasto.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('El monto del gasto debe ser mayor a 0.')
      return
    }

    const newExpense = {
      id: crypto.randomUUID(),
      date: expenseForm.date || getToday(),
      categoryId: selectedCategoryId,
      amount,
      note: expenseForm.note.trim(),
    }

    setExpenses((prev) => [newExpense, ...prev])
    setCanPersist(true)
    setExpenseForm((prev) => ({
      ...prev,
      amount: '',
      note: '',
    }))
  }

  const handleDeleteExpense = (expenseId) => {
    setExpenses((prev) => prev.filter((expense) => expense.id !== expenseId))
  }

  const handleExport = () => {
    const payload = JSON.stringify(
      { version: 2, categories, expenses, bankData },
      null,
      2
    )
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'presupuesto-data.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (event) => {
    setError('')
    const file = event.target.files?.[0]
    if (!file) return

    let parsed
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      setError('El archivo seleccionado no es un JSON válido.')
      event.target.value = ''
      return
    }

    if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.expenses)) {
      setError('El archivo no contiene la estructura esperada.')
      event.target.value = ''
      return
    }

    const validCategories = parsed.categories.every(
      (category) =>
        category &&
        typeof category.id === 'string' &&
        typeof category.name === 'string' &&
        Number.isFinite(category.monthlyBudget)
    )
    const validExpenses = parsed.expenses.every(
      (expense) =>
        expense &&
        typeof expense.id === 'string' &&
        typeof expense.date === 'string' &&
        typeof expense.categoryId === 'string' &&
        Number.isFinite(expense.amount) &&
        typeof expense.note === 'string'
    )

    const nextBankData =
      parsed.bankData && typeof parsed.bankData === 'object'
        ? {
            ...BANK_DEFAULT,
            ...parsed.bankData,
            accountMovements: Array.isArray(parsed.bankData.accountMovements)
              ? parsed.bankData.accountMovements
              : [],
            cardMovements: Array.isArray(parsed.bankData.cardMovements)
              ? parsed.bankData.cardMovements
              : [],
          }
        : BANK_DEFAULT

    if (!validCategories || !validExpenses) {
      setError('El archivo tiene datos inválidos. Revisa el formato.')
      event.target.value = ''
      return
    }

    setCategories(parsed.categories)
    setExpenses(parsed.expenses)
    setBankData(nextBankData)
    setCanPersist(true)
    event.target.value = ''
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">Presupuesto mensual</p>
          <h1>Controla tus categorias y gastos</h1>
        </div>
        <p className="muted">
          Toda la informacion se guarda en este navegador. Usa el respaldo si
          cambias de equipo.
        </p>
      </header>

      {error ? <div className="alert">{error}</div> : null}

      <section className="card">
        <div className="card-header">
          <h2>Banco de Chile</h2>
          <p className="muted">
            Importa los Excel de cuenta corriente y tarjeta para ver saldos y
            movimientos no facturados.
          </p>
        </div>
        <div className="stats bank-stats">
          <div className="stat">
            <span className="stat-label">Saldo cuenta corriente</span>
            <strong>{currency.format(accountBalance)}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">No facturado tarjeta</span>
            <strong>{currency.format(cardUnbilledTotal)}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Cuotas del mes</span>
            <strong>{currency.format(bankData.monthlyInstallmentsDue || 0)}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Total tarjeta mes</span>
            <strong>{currency.format(totalCardDue)}</strong>
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="monthly-installments">Cuotas del mes (manual, CLP)</label>
          <input
            id="monthly-installments"
            type="number"
            min="0"
            step="100"
            value={bankData.monthlyInstallmentsDue || ''}
            onChange={handleMonthlyInstallmentsChange}
            placeholder="0"
          />
        </div>
      </section>

      <section className="section-grid">
        <div className="card">
          <div className="card-header">
            <h2>Cuenta corriente</h2>
            <p className="muted">
              Ultima importacion: {formatDateTime(bankData.lastAccountImportAt)}
            </p>
          </div>
          <label className="file-input">
            Importar Excel cuenta corriente
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleAccountImport}
            />
          </label>
          {accountMovements.length === 0 ? (
            <p className="muted">No hay movimientos importados.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Detalle</th>
                    <th>Cargo</th>
                    <th>Abono</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {accountMovements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{movement.date}</td>
                      <td>{movement.detail}</td>
                      <td>{currency.format(movement.debit)}</td>
                      <td>{currency.format(movement.credit)}</td>
                      <td>{currency.format(movement.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Tarjeta de credito</h2>
            <p className="muted">
              Ultima importacion: {formatDateTime(bankData.lastCardImportAt)}
            </p>
          </div>
          <label className="file-input">
            Importar Excel tarjeta credito
            <input type="file" accept=".xlsx,.xls" onChange={handleCardImport} />
          </label>
          {cardMovements.length === 0 ? (
            <p className="muted">No hay movimientos importados.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Descripcion</th>
                    <th>Ciudad</th>
                    <th>Cuotas</th>
                    <th>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {cardMovements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{movement.date}</td>
                      <td>{movement.description}</td>
                      <td>{movement.city}</td>
                      <td>{movement.installments}</td>
                      <td>{currency.format(movement.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="stats">
        <div className="stat">
          <span className="stat-label">Total presupuestado</span>
          <strong>{currency.format(totalBudget)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Total gastado</span>
          <strong>{currency.format(totalSpent)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Disponible</span>
          <strong className={remaining < 0 ? 'negative' : 'positive'}>
            {currency.format(remaining)}
          </strong>
        </div>
      </section>

      <section className="section-grid">
        <div className="card">
          <div className="card-header">
            <h2>Categorias</h2>
            <p className="muted">Define el presupuesto mensual por categoria.</p>
          </div>
          <form className="form" onSubmit={handleAddCategory}>
            <div className="form-row">
              <label htmlFor="category-name">Nombre</label>
              <input
                id="category-name"
                type="text"
                value={categoryForm.name}
                onChange={(event) =>
                  setCategoryForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="Ej: Alimentacion"
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="category-budget">Presupuesto mensual (CLP)</label>
              <input
                id="category-budget"
                type="number"
                min="0"
                step="100"
                value={categoryForm.budget}
                onChange={(event) =>
                  setCategoryForm((prev) => ({
                    ...prev,
                    budget: event.target.value,
                  }))
                }
                placeholder="200000"
                required
              />
            </div>
            <button type="submit">Agregar categoria</button>
          </form>

          {categories.length === 0 ? (
            <p className="muted">Aun no tienes categorias creadas.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th>Presupuesto</th>
                  <th>Gastado</th>
                  <th>Disponible</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const spent = spentByCategory.get(category.id) ?? 0
                  const available = category.monthlyBudget - spent
                  return (
                    <tr key={category.id}>
                      <td>{category.name}</td>
                      <td>{currency.format(category.monthlyBudget)}</td>
                      <td>{currency.format(spent)}</td>
                      <td className={available < 0 ? 'negative' : 'positive'}>
                        {currency.format(available)}
                      </td>
                      <td className="cell-action">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleDeleteCategory(category.id)}
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Gastos</h2>
            <p className="muted">Registra gastos manuales para cada categoria.</p>
          </div>
          <form className="form" onSubmit={handleAddExpense}>
            <div className="form-row">
              <label htmlFor="expense-date">Fecha</label>
              <input
                id="expense-date"
                type="date"
                value={expenseForm.date}
                onChange={(event) =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    date: event.target.value,
                  }))
                }
              />
            </div>
            <div className="form-row">
              <label htmlFor="expense-category">Categoria</label>
              <select
                id="expense-category"
                value={selectedCategoryId}
                onChange={(event) =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    categoryId: event.target.value,
                  }))
                }
                required
              >
                {categories.length === 0 ? (
                  <option value="">Crea una categoria primero</option>
                ) : null}
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="expense-amount">Monto (CLP)</label>
              <input
                id="expense-amount"
                type="number"
                min="0"
                step="100"
                value={expenseForm.amount}
                onChange={(event) =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    amount: event.target.value,
                  }))
                }
                placeholder="15000"
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="expense-note">Detalle</label>
              <input
                id="expense-note"
                type="text"
                value={expenseForm.note}
                onChange={(event) =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    note: event.target.value,
                  }))
                }
                placeholder="Ej: Supermercado"
              />
            </div>
            <button type="submit">Agregar gasto</button>
          </form>

          {expenses.length === 0 ? (
            <p className="muted">Todavia no hay gastos registrados.</p>
          ) : (
            <ul className="list">
              {expenses.map((expense) => {
                const category = categories.find(
                  (item) => item.id === expense.categoryId
                )
                return (
                  <li key={expense.id} className="list-item">
                    <div>
                      <strong>{currency.format(expense.amount)}</strong>
                      <p className="muted">
                        {expense.date} · {category?.name ?? 'Sin categoria'}
                        {expense.note ? ` · ${expense.note}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => handleDeleteExpense(expense.id)}
                    >
                      Eliminar
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Respaldo</h2>
          <p className="muted">
            Exporta e importa tus datos para mantener el costo en 0.
          </p>
        </div>
        <div className="actions">
          <button type="button" onClick={handleExport}>
            Exportar JSON
          </button>
          <label className="file-input">
            Importar JSON
            <input type="file" accept="application/json" onChange={handleImport} />
          </label>
        </div>
      </section>
    </div>
  )
}

export default App
