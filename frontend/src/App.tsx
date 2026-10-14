import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { EmployeeListPage } from './features/employees/EmployeeListPage'
import { InsightsPage } from './features/insights/InsightsPage'

const navItems = [
  { to: '/employees', label: 'Employees' },
  { to: '/insights', label: 'Insights' },
]

export function App() {
  return (
    <>
      <AppBar position="static" elevation={0}>
        <Toolbar component="nav" aria-label="Main">
          <Typography variant="h6" component="span" sx={{ mr: 4 }}>
            ACME Salaries
          </Typography>
          {navItems.map((item) => (
            <Button
              key={item.to}
              component={NavLink}
              to={item.to}
              color="inherit"
              sx={{ '&.active': { textDecoration: 'underline', textUnderlineOffset: 6 } }}
            >
              {item.label}
            </Button>
          ))}
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="xl" sx={{ py: 3 }}>
        <Box>
          <Routes>
            <Route path="/" element={<Navigate to="/employees" replace />} />
            <Route path="/employees" element={<EmployeeListPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="*" element={<Typography>Page not found.</Typography>} />
          </Routes>
        </Box>
      </Container>
    </>
  )
}
