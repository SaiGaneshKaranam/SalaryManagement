import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from './App'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App shell', () => {
  it('redirects the root path to the employee list', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'Employees' })).toBeInTheDocument()
  })

  it('renders the insights page from the main navigation route', () => {
    renderAt('/insights')
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })
})
