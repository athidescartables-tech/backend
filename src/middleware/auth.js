import jwt from "jsonwebtoken"
import { executeQuery } from "../config/database.js"

// Middleware para verificar JWT
export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"]
  const token = authHeader && authHeader.split(" ")[1]

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Token de acceso requerido",
      code: "NO_TOKEN",
    })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Verificar que el usuario existe y está activo
    const user = await executeQuery("SELECT id, name, email, role, active FROM users WHERE id = ? AND active = TRUE", [
      decoded.userId,
    ])

    if (user.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Token inválido o usuario inactivo",
        code: "INVALID_TOKEN",
      })
    }

    req.user = user[0]
    next()
  } catch (error) {
    let message = "Token no válido"
    let code = "INVALID_TOKEN"

    if (error.name === "TokenExpiredError") {
      message = "Tu sesión ha expirado. Inicia sesión nuevamente."
      code = "TOKEN_EXPIRED"
    } else if (error.name === "JsonWebTokenError") {
      message = "Token malformado"
      code = "MALFORMED_TOKEN"
    }

    return res.status(403).json({
      success: false,
      message,
      code,
    })
  }
}

// Middleware para verificar rol de administrador
export const requireAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Acceso denegado. Se requieren permisos de administrador",
      code: "INSUFFICIENT_PERMISSIONS",
    })
  }
  next()
}

// Middleware para verificar roles específicos
export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Acceso denegado. No tienes permisos suficientes",
        code: "INSUFFICIENT_PERMISSIONS",
      })
    }
    next()
  }
}

// Middleware para verificar que el usuario puede realizar ventas
export const canMakeSales = (req, res, next) => {
  if (!["admin", "empleado"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "No tienes permisos para realizar ventas",
      code: "INSUFFICIENT_PERMISSIONS",
    })
  }
  next()
}
