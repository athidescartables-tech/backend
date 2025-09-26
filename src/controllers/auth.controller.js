import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { executeQuery } from "../config/database.js"

// Función helper para logs de autenticación
const logAuthEvent = (event, email, success = true, error = null) => {
  const timestamp = new Date().toISOString()
  const status = success ? "SUCCESS" : "FAILED"
  console.log(`[${timestamp}] AUTH_${event.toUpperCase()}: ${email} - ${status}${error ? ` - ${error}` : ""}`)
}

// Login
export const login = async (req, res) => {
  const { email, password } = req.body

  try {
    // Buscar usuario
    const users = await executeQuery("SELECT id, name, email, password, role, active FROM users WHERE email = ?", [
      email,
    ])

    if (users.length === 0) {
      logAuthEvent("login", email, false, "Usuario no encontrado")
      return res.status(401).json({
        success: false,
        message: "Email o contraseña incorrectos",
        code: "INVALID_CREDENTIALS",
      })
    }

    const user = users[0]

    // Verificar si el usuario está activo
    if (!user.active) {
      logAuthEvent("login", email, false, "Usuario inactivo")
      return res.status(401).json({
        success: false,
        message: "Tu cuenta ha sido desactivada. Contacta al administrador.",
        code: "ACCOUNT_DISABLED",
      })
    }

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.password)
    if (!isValidPassword) {
      logAuthEvent("login", email, false, "Contraseña incorrecta")
      return res.status(401).json({
        success: false,
        message: "Email o contraseña incorrectos",
        code: "INVALID_CREDENTIALS",
      })
    }

    // Generar JWT
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "24h",
      },
    )

    // Actualizar último login
    await executeQuery("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", [user.id])

    // Respuesta exitosa (sin incluir la contraseña)
    const { password: _, ...userWithoutPassword } = user

    logAuthEvent("login", email, true)

    res.json({
      success: true,
      message: "Inicio de sesión exitoso",
      data: {
        user: userWithoutPassword,
        token,
      },
    })
  } catch (error) {
    console.error("Error en login:", error)
    logAuthEvent("login", email, false, error.message)

    res.status(500).json({
      success: false,
      message: "Error interno del servidor. Intenta nuevamente.",
      code: "INTERNAL_ERROR",
    })
  }
}

// Registro público (crea empleado por defecto)
export const register = async (req, res) => {
  const { name, email, password } = req.body

  try {
    // Verificar si el email ya existe
    const existingUsers = await executeQuery("SELECT id FROM users WHERE email = ?", [email])

    if (existingUsers.length > 0) {
      logAuthEvent("register", email, false, "Email ya existe")
      return res.status(400).json({
        success: false,
        message: "Ya existe una cuenta con este email",
        code: "EMAIL_EXISTS",
      })
    }

    // Validaciones adicionales
    if (name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "El nombre debe tener al menos 2 caracteres",
        code: "INVALID_NAME",
      })
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "La contraseña debe tener al menos 6 caracteres",
        code: "WEAK_PASSWORD",
      })
    }

    // Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 12)

    // Crear usuario como empleado por defecto
    const result = await executeQuery(
      "INSERT INTO users (name, email, password, role, created_at) VALUES (?, ?, ?, 'empleado', CURRENT_TIMESTAMP)",
      [name.trim(), email.toLowerCase(), hashedPassword],
    )

    // Generar JWT para login automático
    const token = jwt.sign(
      {
        userId: result.insertId,
        email: email.toLowerCase(),
        role: "empleado",
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "24h",
      },
    )

    logAuthEvent("register", email, true)

    res.status(201).json({
      success: true,
      message: "Cuenta creada exitosamente",
      data: {
        user: {
          id: result.insertId,
          name: name.trim(),
          email: email.toLowerCase(),
          role: "empleado",
          active: true,
        },
        token,
      },
    })
  } catch (error) {
    console.error("Error en registro:", error)
    logAuthEvent("register", email, false, error.message)

    res.status(500).json({
      success: false,
      message: "Error interno del servidor. Intenta nuevamente.",
      code: "INTERNAL_ERROR",
    })
  }
}

// Obtener perfil del usuario
export const getProfile = async (req, res) => {
  try {
    const { password: _, ...userWithoutPassword } = req.user

    res.json({
      success: true,
      data: userWithoutPassword,
    })
  } catch (error) {
    console.error("Error obteniendo perfil:", error)
    res.status(500).json({
      success: false,
      message: "Error obteniendo información del perfil",
      code: "INTERNAL_ERROR",
    })
  }
}

// Cambiar contraseña
export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body
  const userId = req.user.id

  try {
    // Obtener contraseña actual
    const users = await executeQuery("SELECT password FROM users WHERE id = ?", [userId])

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
        code: "USER_NOT_FOUND",
      })
    }

    // Verificar contraseña actual
    const isValidPassword = await bcrypt.compare(currentPassword, users[0].password)
    if (!isValidPassword) {
      logAuthEvent("change_password", req.user.email, false, "Contraseña actual incorrecta")
      return res.status(400).json({
        success: false,
        message: "La contraseña actual es incorrecta",
        code: "INVALID_CURRENT_PASSWORD",
      })
    }

    // Validar nueva contraseña
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "La nueva contraseña debe tener al menos 6 caracteres",
        code: "WEAK_PASSWORD",
      })
    }

    // Verificar que la nueva contraseña sea diferente
    const isSamePassword = await bcrypt.compare(newPassword, users[0].password)
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: "La nueva contraseña debe ser diferente a la actual",
        code: "SAME_PASSWORD",
      })
    }

    // Hashear nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 12)

    // Actualizar contraseña
    await executeQuery("UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      hashedPassword,
      userId,
    ])

    logAuthEvent("change_password", req.user.email, true)

    res.json({
      success: true,
      message: "Contraseña actualizada correctamente",
    })
  } catch (error) {
    console.error("Error cambiando contraseña:", error)
    logAuthEvent("change_password", req.user.email, false, error.message)

    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "INTERNAL_ERROR",
    })
  }
}

// Crear usuario (solo admin)
export const createUser = async (req, res) => {
  const { name, email, password, role } = req.body

  try {
    // Verificar si el email ya existe
    const existingUsers = await executeQuery("SELECT id FROM users WHERE email = ?", [email])

    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Ya existe un usuario con este email",
        code: "EMAIL_EXISTS",
      })
    }

    // Validaciones
    if (!["admin", "empleado"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Rol inválido. Debe ser 'admin' o 'empleado'",
        code: "INVALID_ROLE",
      })
    }

    // Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 12)

    // Crear usuario
    const result = await executeQuery(
      "INSERT INTO users (name, email, password, role, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
      [name.trim(), email.toLowerCase(), hashedPassword, role],
    )

    logAuthEvent("create_user", email, true, `Creado por ${req.user.email}`)

    res.status(201).json({
      success: true,
      message: "Usuario creado correctamente",
      data: {
        id: result.insertId,
        name: name.trim(),
        email: email.toLowerCase(),
        role,
        active: true,
      },
    })
  } catch (error) {
    console.error("Error creando usuario:", error)
    logAuthEvent("create_user", email, false, error.message)

    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "INTERNAL_ERROR",
    })
  }
}

// Listar usuarios (solo admin)
export const getUsers = async (req, res) => {
  try {
    const users = await executeQuery(
      "SELECT id, name, email, role, active, created_at, last_login FROM users ORDER BY created_at DESC",
    )

    res.json({
      success: true,
      data: users,
    })
  } catch (error) {
    console.error("Error obteniendo usuarios:", error)
    res.status(500).json({
      success: false,
      message: "Error obteniendo lista de usuarios",
      code: "INTERNAL_ERROR",
    })
  }
}

// Actualizar usuario (solo admin)
export const updateUser = async (req, res) => {
  const { id } = req.params
  const { name, email, role, active } = req.body

  try {
    // Verificar si el usuario existe
    const users = await executeQuery("SELECT id, email FROM users WHERE id = ?", [id])

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
        code: "USER_NOT_FOUND",
      })
    }

    // Verificar si el email ya existe en otro usuario
    if (email !== users[0].email) {
      const emailExists = await executeQuery("SELECT id FROM users WHERE email = ? AND id != ?", [email, id])
      if (emailExists.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Ya existe otro usuario con este email",
          code: "EMAIL_EXISTS",
        })
      }
    }

    // Actualizar usuario
    await executeQuery(
      "UPDATE users SET name = ?, email = ?, role = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [name.trim(), email.toLowerCase(), role, active, id],
    )

    logAuthEvent("update_user", email, true, `Actualizado por ${req.user.email}`)

    res.json({
      success: true,
      message: "Usuario actualizado correctamente",
    })
  } catch (error) {
    console.error("Error actualizando usuario:", error)
    logAuthEvent("update_user", req.body.email, false, error.message)

    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "INTERNAL_ERROR",
    })
  }
}

// Eliminar usuario (solo admin)
export const deleteUser = async (req, res) => {
  const { id } = req.params

  try {
    // Verificar si el usuario existe
    const users = await executeQuery("SELECT id, email FROM users WHERE id = ?", [id])

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
        code: "USER_NOT_FOUND",
      })
    }

    const user = users[0]

    // Prevenir que el admin se elimine a sí mismo
    if (Number.parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "No puedes eliminar tu propia cuenta",
        code: "CANNOT_DELETE_SELF",
      })
    }

    // Eliminar usuario
    await executeQuery("DELETE FROM users WHERE id = ?", [id])

    logAuthEvent("delete_user", user.email, true, `Eliminado por ${req.user.email}`)

    res.json({
      success: true,
      message: "Usuario eliminado correctamente",
    })
  } catch (error) {
    console.error("Error eliminando usuario:", error)
    logAuthEvent("delete_user", req.params.id, false, error.message)

    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "INTERNAL_ERROR",
    })
  }
}
