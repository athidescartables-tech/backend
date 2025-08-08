import { body, validationResult } from "express-validator"

// Middleware para manejar errores de validación
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    const firstError = errors.array()[0]
    return res.status(400).json({
      success: false,
      message: firstError.msg,
      code: "VALIDATION_ERROR",
      errors: errors.array(),
    })
  }
  next()
}

// Validaciones para login
export const validateLogin = [
  body("email").isEmail().normalizeEmail().withMessage("Ingresa un email válido"),
  body("password").isLength({ min: 6 }).withMessage("La contraseña debe tener al menos 6 caracteres"),
  handleValidationErrors,
]

// Validaciones para registro (menos estrictas para desarrollo)
export const validateRegister = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/)
    .withMessage("El nombre solo puede contener letras y espacios"),
  body("email").isEmail().normalizeEmail().withMessage("Ingresa un email válido"),
  body("password").isLength({ min: 6 }).withMessage("La contraseña debe tener al menos 6 caracteres"),
  handleValidationErrors,
]

// Validaciones para cambio de contraseña
export const validatePasswordChange = [
  body("currentPassword").notEmpty().withMessage("La contraseña actual es requerida"),
  body("newPassword").isLength({ min: 6 }).withMessage("La nueva contraseña debe tener al menos 6 caracteres"),
  handleValidationErrors,
]

// Validaciones para crear usuario (admin)
export const validateCreateUser = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/)
    .withMessage("El nombre solo puede contener letras y espacios"),
  body("email").isEmail().normalizeEmail().withMessage("Ingresa un email válido"),
  body("password").isLength({ min: 6 }).withMessage("La contraseña debe tener al menos 6 caracteres"),
  body("role").isIn(["admin", "empleado"]).withMessage("El rol debe ser admin o empleado"),
  handleValidationErrors,
]

// Validaciones para categorías
export const validateCreateCategory = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s&.-]+$/)
    .withMessage("El nombre solo puede contener letras, números, espacios y algunos símbolos básicos"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("La descripción no puede exceder 500 caracteres"),
  body("color")
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/)
    .withMessage("El color debe ser un código hexadecimal válido"),
  body("icon").optional().isLength({ min: 1, max: 10 }).withMessage("El icono debe tener entre 1 y 10 caracteres"),
  handleValidationErrors,
]

export const validateUpdateCategory = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s&.-]+$/)
    .withMessage("El nombre solo puede contener letras, números, espacios y algunos símbolos básicos"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("La descripción no puede exceder 500 caracteres"),
  body("color")
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/)
    .withMessage("El color debe ser un código hexadecimal válido"),
  body("icon").optional().isLength({ min: 1, max: 10 }).withMessage("El icono debe tener entre 1 y 10 caracteres"),
  handleValidationErrors,
]

// Validaciones para productos - CORREGIDAS
export const validateCreateProduct = [
  body("name").trim().isLength({ min: 2, max: 200 }).withMessage("El nombre debe tener entre 2 y 200 caracteres"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("La descripción no puede exceder 1000 caracteres"),
  body("price").isFloat({ min: 0.01 }).withMessage("El precio debe ser mayor a 0"),
  body("cost").optional().isFloat({ min: 0 }).withMessage("El costo no puede ser negativo"),
  body("stock").optional().isFloat({ min: 0 }).withMessage("El stock no puede ser negativo"),
  body("min_stock").optional().isFloat({ min: 0 }).withMessage("El stock mínimo no puede ser negativo"),
  body("category_id").optional().isInt({ min: 1 }).withMessage("La categoría debe ser válida"),
  body("barcode")
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("El código de barras debe tener entre 1 y 50 caracteres"),
  body("image")
    .optional({ checkFalsy: true })
    .custom((value) => {
      if (!value || value.trim() === "") {
        return true // Permitir cadenas vacías
      }
      // Solo validar URL si hay un valor
      const urlRegex = /^https?:\/\/.+/
      if (!urlRegex.test(value)) {
        throw new Error("La imagen debe ser una URL válida")
      }
      return true
    }),
  handleValidationErrors,
]

export const validateUpdateProduct = [
  body("name").trim().isLength({ min: 2, max: 200 }).withMessage("El nombre debe tener entre 2 y 200 caracteres"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("La descripción no puede exceder 1000 caracteres"),
  body("price").isFloat({ min: 0.01 }).withMessage("El precio debe ser mayor a 0"),
  body("cost").optional().isFloat({ min: 0 }).withMessage("El costo no puede ser negativo"),
  body("min_stock").optional().isFloat({ min: 0 }).withMessage("El stock mínimo no puede ser negativo"),
  body("category_id").optional().isInt({ min: 1 }).withMessage("La categoría debe ser válida"),
  body("barcode")
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("El código de barras debe tener entre 1 y 50 caracteres"),
  body("image")
    .optional({ checkFalsy: true })
    .custom((value) => {
      if (!value || value.trim() === "") {
        return true // Permitir cadenas vacías
      }
      // Solo validar URL si hay un valor
      const urlRegex = /^https?:\/\/.+/
      if (!urlRegex.test(value)) {
        throw new Error("La imagen debe ser una URL válida")
      }
      return true
    }),
  body("active").optional().isBoolean().withMessage("El estado debe ser verdadero o falso"),
  handleValidationErrors,
]

// CORREGIDO: Validaciones para movimientos de stock con soporte para decimales
export const validateStockMovement = [
  body("product_id").isInt({ min: 1 }).withMessage("Debe seleccionar un producto válido"),
  body("type")
    .isIn(["entrada", "salida", "ajuste"])
    .withMessage("El tipo de movimiento debe ser: entrada, salida o ajuste"),
  // CORREGIDO: Permitir decimales para productos por kg
  body("quantity")
    .isFloat({ min: 0.001 })
    .withMessage("La cantidad debe ser mayor a 0")
    .custom(async (value, { req }) => {
      // Validación adicional según el tipo de producto
      if (req.body.product_id) {
        // Aquí podrías hacer una consulta a la BD para validar según unit_type
        // Por ahora solo validamos que sea positivo
        if (Number.parseFloat(value) <= 0) {
          throw new Error("La cantidad debe ser mayor a 0")
        }
      }
      return true
    }),
  body("reason").trim().isLength({ min: 5, max: 500 }).withMessage("La razón debe tener entre 5 y 500 caracteres"),
  handleValidationErrors,
]

// ACTUALIZADO: Validaciones para ventas con soporte para múltiples pagos y decimales
export const validateCreateSale = [
  body("items").isArray({ min: 1 }).withMessage("La venta debe tener al menos un producto"),
  body("items.*.product_id").isInt({ min: 1 }).withMessage("ID de producto inválido"),
  // CORREGIDO: Permitir cantidades decimales para productos por kg
  body("items.*.quantity")
    .isFloat({ min: 0.001 })
    .withMessage("La cantidad debe ser mayor a 0")
    .custom((value, { req }) => {
      const quantity = Number.parseFloat(value)
      if (isNaN(quantity) || quantity <= 0) {
        throw new Error("La cantidad debe ser un número válido mayor a 0")
      }
      return true
    }),
  body("items.*.unit_price").isFloat({ min: 0.01 }).withMessage("El precio unitario debe ser mayor a 0"),
  body("subtotal").isFloat({ min: 0.01 }).withMessage("El subtotal debe ser mayor a 0"),
  body("discount").optional().isFloat({ min: 0 }).withMessage("El descuento no puede ser negativo"),
  body("tax").optional().isFloat({ min: 0 }).withMessage("El impuesto no puede ser negativo"),
  body("total").isFloat({ min: 0.01 }).withMessage("El total debe ser mayor a 0"),

  // NUEVO: Validación condicional para pago simple o múltiple
  body("payment_method")
    .optional()
    .isIn(["efectivo", "tarjeta_credito", "transferencia", "cuenta_corriente", "multiple"])
    .withMessage("Método de pago inválido"),

  // NUEVO: Validación para múltiples métodos de pago
  body("payment_methods")
    .optional()
    .isArray({ min: 1 })
    .withMessage("Los métodos de pago múltiples deben ser un array con al menos un elemento"),

  body("payment_methods.*.method")
    .optional()
    .isIn(["efectivo", "tarjeta_credito", "transferencia", "cuenta_corriente"])
    .withMessage("Método de pago múltiple inválido"),

  body("payment_methods.*.amount")
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage("El monto de cada método de pago debe ser mayor a 0"),

  body("payment_data").optional().isObject().withMessage("Los datos de pago deben ser un objeto"),

  body("customer_id").custom((value) => {
    // Permitir null, undefined o un entero válido mayor a 0
    if (value === null || value === undefined) {
      return true // Permitir null/undefined para ventas rápidas
    }
    if (Number.isInteger(value) && value > 0) {
      return true // Permitir enteros válidos
    }
    throw new Error("ID de cliente debe ser un número entero válido o null para ventas rápidas")
  }),
  body("notes").optional().trim().isLength({ max: 1000 }).withMessage("Las notas no pueden exceder 1000 caracteres"),

  // NUEVO: Validación personalizada para asegurar coherencia entre pago simple y múltiple
  body().custom((body) => {
    const { payment_method, payment_methods } = body

    // Si hay payment_methods, debe ser un array válido
    if (payment_methods && Array.isArray(payment_methods)) {
      if (payment_methods.length === 0) {
        throw new Error("Los métodos de pago múltiples no pueden estar vacíos")
      }

      // Validar que cada método tenga los campos requeridos
      for (const pm of payment_methods) {
        if (!pm.method || !["efectivo", "tarjeta_credito", "transferencia", "cuenta_corriente"].includes(pm.method)) {
          throw new Error("Cada método de pago múltiple debe tener un método válido")
        }
        if (!pm.amount || isNaN(Number.parseFloat(pm.amount)) || Number.parseFloat(pm.amount) <= 0) {
          throw new Error("Cada método de pago múltiple debe tener un monto válido mayor a 0")
        }
      }

      // Si hay payment_methods, payment_method debe ser 'multiple' o no estar presente
      if (payment_method && payment_method !== "multiple") {
        throw new Error("Para pagos múltiples, payment_method debe ser 'multiple' o no estar presente")
      }
    } else {
      // Si no hay payment_methods, debe haber payment_method válido
      if (
        !payment_method ||
        !["efectivo", "tarjeta_credito", "transferencia", "cuenta_corriente"].includes(payment_method)
      ) {
        throw new Error("Se requiere un método de pago válido para pago simple")
      }
    }

    return true
  }),

  handleValidationErrors,
]

// Validaciones para clientes
export const validateCreateCustomer = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/)
    .withMessage("El nombre solo puede contener letras y espacios"),
  body("email").optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage("Ingresa un email válido"),
  body("phone")
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^[\d\s\-+()]+$/)
    .withMessage("El teléfono solo puede contener números, espacios y símbolos básicos"),
  body("document_type").optional().isIn(["dni", "cuit", "cuil", "pasaporte"]).withMessage("Tipo de documento inválido"),
  body("document_number")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 7, max: 15 })
    .withMessage("El número de documento debe tener entre 7 y 15 caracteres"),
  body("address")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage("La dirección no puede exceder 200 caracteres"),
  body("city")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage("La ciudad no puede exceder 100 caracteres"),
  body("credit_limit").optional().isFloat({ min: 0 }).withMessage("El límite de crédito no puede ser negativo"),
  body("notes")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage("Las notas no pueden exceder 500 caracteres"),
  handleValidationErrors,
]

export const validateUpdateCustomer = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/)
    .withMessage("El nombre solo puede contener letras y espacios"),
  body("email").optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage("Ingresa un email válido"),
  body("phone")
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^[\d\s\-+()]+$/)
    .withMessage("El teléfono solo puede contener números, espacios y símbolos básicos"),
  body("document_type").optional().isIn(["dni", "cuit", "cuil", "pasaporte"]).withMessage("Tipo de documento inválido"),
  body("document_number")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 7, max: 15 })
    .withMessage("El número de documento debe tener entre 7 y 15 caracteres"),
  body("address")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage("La dirección no puede exceder 200 caracteres"),
  body("city")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage("La ciudad no puede exceder 100 caracteres"),
  body("credit_limit").optional().isFloat({ min: 0 }).withMessage("El límite de crédito no puede ser negativo"),
  body("notes")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage("Las notas no pueden exceder 500 caracteres"),
  body("active").optional().isBoolean().withMessage("El estado debe ser verdadero o falso"),
  handleValidationErrors,
]

// Validaciones para transacciones de cuenta corriente
export const validateAccountTransaction = [
  body("customer_id").isInt({ min: 1 }).withMessage("Debe seleccionar un cliente válido"),
  body("type").isIn(["venta", "pago", "ajuste_debito", "ajuste_credito"]).withMessage("Tipo de transacción inválido"),
  body("amount").isFloat({ min: 0.01 }).withMessage("El monto debe ser mayor a 0"),
  body("description")
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage("La descripción debe tener entre 5 y 500 caracteres"),
  body("reference")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage("La referencia no puede exceder 100 caracteres"),
  handleValidationErrors,
]
