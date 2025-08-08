import express from "express"
import {
  getCurrentCashStatus,
  openCash,
  closeCash,
  getCashHistory,
  getCashSessionDetails,
  getCashMovements,
  createCashMovement,
  getCashSettings,
  updateCashSettings,
} from "../controllers/cash.controller.js"
import { authenticateToken, requireRole } from "../middleware/auth.js"

const router = express.Router()

// Todas las rutas requieren autenticación
router.use(authenticateToken)

// Rutas públicas (para todos los usuarios autenticados)
router.get("/status", getCurrentCashStatus)
router.get("/movements", getCashMovements)
router.get("/settings", getCashSettings)

// NUEVAS RUTAS: Historial y detalles
router.get("/history", getCashHistory)
router.get("/sessions/:id", getCashSessionDetails)

// Rutas que requieren permisos de escritura
router.post("/open", openCash)
router.post("/close", closeCash) // ACTUALIZADO: Nuevo endpoint de cierre
router.post("/movements", createCashMovement)

// Rutas que requieren permisos de administrador
router.put("/settings", requireRole(["admin"]), updateCashSettings)

export default router
