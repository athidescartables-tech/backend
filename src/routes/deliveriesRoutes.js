import express from "express"
import {
  getDeliveries,
  getDeliveryById,
  createDelivery,
  updateDeliveryStatus,
  getDriverDeliveries,
  getDeliveriesStats,
} from "../controllers/deliveries.controller.js"
import { authenticateToken } from "../middleware/auth.js"

const router = express.Router()

// Todas las rutas requieren autenticación
router.use(authenticateToken)

// Rutas de lectura
router.get("/", getDeliveries)
router.get("/stats", getDeliveriesStats)
router.get("/driver/:driver_id", getDriverDeliveries)
router.get("/:id", getDeliveryById)

// Rutas de escritura
router.post("/", createDelivery)
router.patch("/:id/status", updateDeliveryStatus)

export default router
