import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { bootstrapTheme } from './theme.js'
import './styles.css'

const container = document.getElementById('root')
if (container === null) throw new Error('#root không tồn tại')

// Trước render đầu tiên: cấu hình thật nằm trong SQLite đã mã hoá và chỉ về sau một vòng IPC,
// nên nếu chờ nó thì cửa sổ luôn mở ra màu sáng rồi mới đổi.
bootstrapTheme()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
