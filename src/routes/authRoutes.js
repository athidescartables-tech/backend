import express from "express"
import {
  login,
  register,
  getProfile,
  changePassword,
  createUser,
  getUsers,
  updateUser,
} from "../controllers/auth.controller.js"
import { authenticateToken, requireAdmin } from "../middleware/auth.js"
import {
  validateLogin,
  validateRegister,
  validatePasswordChange,
  validateCreateUser,
} from "../middleware/validation.js"

const router = express.Router()

// Rutas públicas
router.post("/login", validateLogin, login)
router.post("/register", validateRegister, register)

// Rutas protegidas
router.get("/profile", authenticateToken, getProfile)
router.post("/change-password", authenticateToken, validatePasswordChange, changePassword)

// Rutas solo para admin
router.post("/users", authenticateToken, requireAdmin, validateCreateUser, createUser)
router.get("/users", authenticateToken, requireAdmin, getUsers)
router.put("/users/:id", authenticateToken, requireAdmin, updateUser)

export default router
