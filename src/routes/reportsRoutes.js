import express from "express"
import {
  getSalesReport,
  getTopProducts,
  getTopCustomers,
  getPaymentMethodsReport,
  getCategoryReport,
  getInventoryReport,
  getReportsStats,
} from "../controllers/reports.controller.js"
import { authenticateToken } from "../middleware/auth.js"

const router = express.Router()

// Todas las rutas requieren autenticación
router.use(authenticateToken)

// Rutas de reportes - CORREGIDO: Usar rutas sin prefijo adicional ya que se monta en /api/reports
router.get("/sales", getSalesReport)
router.get("/products/top", getTopProducts)
router.get("/customers/top", getTopCustomers)
router.get("/payment-methods", getPaymentMethodsReport)
router.get("/categories", getCategoryReport)
router.get("/inventory", getInventoryReport)
router.get("/stats", getReportsStats)

export default router
