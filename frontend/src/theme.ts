import { createTheme } from '@mui/material'

export const theme = createTheme({
  palette: { primary: { main: '#1f4e79' } },
  components: {
    MuiTableCell: { styleOverrides: { head: { fontWeight: 600 } } },
  },
})
