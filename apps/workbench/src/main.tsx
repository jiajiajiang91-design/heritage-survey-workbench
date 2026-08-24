import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
// 字体随依赖本地加载，不走外网；族名是 Noto Sans SC Variable 与 Geist Variable
import "@fontsource-variable/noto-sans-sc"
import "@fontsource-variable/geist"
// 令牌与基础组件先于外壳样式加载（07 第 5 节：先建组件再拼页面）；各屏样式随页面组件导入
import "./tokens.css"
import "./components.css"
import "./shell/shell.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
