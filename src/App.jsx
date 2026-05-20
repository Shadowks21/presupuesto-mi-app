import { useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'presupuesto-data:v1'
const currency = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
})

const getToday = () => new Date().toISOString().slice(0, 10)

const loadInitialData = () => {
  if (typeof window === 'undefined') {
    return { categories: [], expenses: [], error: '', canPersist: true }
  }

  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) {
    return { categories: [], expenses: [], error: '', canPersist: true }
  }

  try {
    const parsed = JSON.parse(stored)
    return {
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      error: '',
      canPersist: true,
    }
  } catch {
    return {
      categories: [],
      expenses: [],
      error: 'No se pudo leer el almacenamiento local. Intenta importar un respaldo.',
      canPersist: false,
    }
  }
}

function App() {
  const [initialData] = useState(loadInitialData)
  const [categories, setCategories] = useState(initialData.categories)
  const [expenses, setExpenses] = useState(initialData.expenses)
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
      JSON.stringify({ version: 1, categories, expenses })
    )
  }, [categories, expenses, canPersist])

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
    const payload = JSON.stringify({ version: 1, categories, expenses }, null, 2)
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

    if (!validCategories || !validExpenses) {
      setError('El archivo tiene datos inválidos. Revisa el formato.')
      event.target.value = ''
      return
    }

    setCategories(parsed.categories)
    setExpenses(parsed.expenses)
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
