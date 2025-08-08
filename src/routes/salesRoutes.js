import express from "express"
import {
  getSales,
  getSaleById,
  createSale,
  cancelSale,
  getSalesStats,
  getDailySalesReport,
} from "../controllers/sales.controller.js"
import { authenticateToken, requireRole } from "../middleware/auth.js"
import { validateCreateSale } from "../middleware/validation.js"

const router = express.Router()

// Todas las rutas requieren autenticación
router.use(authenticateToken)

// Rutas públicas (para todos los usuarios autenticados)
router.get("/", getSales)
router.get("/stats", getSalesStats)
router.get("/report/daily", getDailySalesReport)
router.get("/:id", getSaleById)

// Rutas que requieren permisos de escritura
router.post("/", validateCreateSale, createSale)

// Rutas que requieren permisos de administrador
router.patch("/:id/cancel", requireRole(["admin"]), cancelSale)

export default router
