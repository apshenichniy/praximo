import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "../styles.css"
import "./ui-lab.css"
import { UiLab } from "./app.tsx"

const root = document.querySelector("#root")

if (!root) {
  throw new Error("UI Lab root is missing")
}

createRoot(root).render(
  <StrictMode>
    <UiLab />
  </StrictMode>,
)
