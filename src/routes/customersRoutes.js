import express from "express"
import {
  getCustomers,
  getCustomerById,
  getCustomerBalance,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerTransactions,
  createAccountTransaction,
  getCustomersStats,
} from "../controllers/customers.controller.js"
import { authenticateToken, requireRole } from "../middleware/auth.js"
import { validateCreateCustomer, validateUpdateCustomer, validateAccountTransaction } from "../middleware/validation.js"

const router = express.Router()

// Todas las rutas requieren autenticación
router.use(authenticateToken)

// Rutas públicas (empleados y admin)
router.get("/", getCustomers)
router.get("/stats", getCustomersStats)
router.get("/:id", getCustomerById)
router.get("/:id/balance", getCustomerBalance)
router.get("/:id/transactions", getCustomerTransactions)
router.post("/", validateCreateCustomer, createCustomer)
router.post("/transactions", validateAccountTransaction, createAccountTransaction)

// Rutas que requieren permisos de admin
router.put("/:id", requireRole(["admin"]), validateUpdateCustomer, updateCustomer)
router.delete("/:id", requireRole(["admin"]), deleteCustomer)

export default router
