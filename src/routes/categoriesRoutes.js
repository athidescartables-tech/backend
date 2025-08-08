import express from "express"
import {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  restoreCategory,
  getCategoryStats,
} from "../controllers/categories.controller.js"
import { authenticateToken, requireAdmin } from "../middleware/auth.js"
import { validateCreateCategory, validateUpdateCategory } from "../middleware/validation.js"

const router = express.Router()

// Todas las rutas requieren autenticación
router.use(authenticateToken)

// Rutas públicas (para todos los usuarios autenticados)
router.get("/", getCategories)
router.get("/stats", getCategoryStats)
router.get("/:id", getCategoryById)

// Rutas que requieren permisos de escritura (admin y empleado pueden crear/editar)
router.post("/", validateCreateCategory, createCategory)
router.put("/:id", validateUpdateCategory, updateCategory)
router.patch("/:id/restore", restoreCategory)

// Rutas que requieren permisos de administrador
router.delete("/:id", requireAdmin, deleteCategory)

export default router
