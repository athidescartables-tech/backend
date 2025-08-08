import { executeQuery, executeTransaction } from "../config/database.js"

// FUNCIÓN CORREGIDA: Registrar venta en caja para TODOS los métodos de pago
export const registerSaleInCash = async (saleId, totalAmount, paymentMethod, paymentMethods, userId) => {
  try {
    console.log("💰 Registrando venta en caja:", {
      saleId,
      totalAmount,
      paymentMethod,
      paymentMethods,
      userId,
    })

    // Verificar que hay una caja abierta
    const openSession = await executeQuery("SELECT id FROM cash_sessions WHERE status = 'open' LIMIT 1")

    if (openSession.length === 0) {
      console.warn("⚠️ No hay caja abierta para registrar la venta")
      return // No lanzar error, solo avisar
    }

    const sessionId = openSession[0].id

    // CORREGIDO: Registrar movimientos según el tipo de pago
    if (paymentMethod === "multiple" && paymentMethods && Array.isArray(paymentMethods)) {
      // Para pagos múltiples, crear un movimiento por cada método
      console.log("💳 Registrando venta con múltiples métodos de pago")

      for (const pm of paymentMethods) {
        const amount = Number.parseFloat(pm.amount) || 0
        if (amount > 0) {
          await executeQuery(
            `INSERT INTO cash_movements (
            cash_session_id, type, amount, description, payment_method, 
            sale_id, user_id, created_at
          ) VALUES (?, 'sale', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [sessionId, amount, `Venta #${saleId} (${pm.method})`, pm.method, saleId, userId],
          )

          console.log(`✅ Movimiento registrado: ${pm.method} - ${amount}`)
        }
      }
    } else {
      // Para pago simple, registrar un solo movimiento
      console.log("💵 Registrando venta con método simple:", paymentMethod)

      await executeQuery(
        `INSERT INTO cash_movements (
        cash_session_id, type, amount, description, payment_method,
        sale_id, user_id, created_at
      ) VALUES (?, 'sale', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [sessionId, Number.parseFloat(totalAmount), `Venta #${saleId}`, paymentMethod, saleId, userId],
      )

      console.log(`✅ Venta registrada en caja: ${paymentMethod} - ${totalAmount}`)
    }
  } catch (error) {
    console.error("❌ Error registrando venta en caja:", error)
    // No lanzar error para no bloquear la venta
  }
}

// Función auxiliar para formatear métodos de pago
const formatPaymentMethods = (sale) => {
  if (sale.payment_method === "multiple" && sale.payment_methods) {
    try {
      const methods = JSON.parse(sale.payment_methods)
      return {
        ...sale,
        payment_methods_formatted: methods,
        payment_method_display: methods
          .map((m) => `${getPaymentMethodLabel(m.method)}: ${formatCurrency(m.amount)}`)
          .join(", "),
      }
    } catch (error) {
      console.warn("Error parsing payment_methods:", error)
      return sale
    }
  }
  return {
    ...sale,
    payment_method_display: getPaymentMethodLabel(sale.payment_method),
  }
}

// Función auxiliar para obtener etiquetas de métodos de pago
const getPaymentMethodLabel = (method) => {
  const labels = {
    efectivo: "Efectivo",
    tarjeta_credito: "T. Crédito",
    transferencia: "Transferencia",
    cuenta_corriente: "Cta. Corriente",
  }
  return labels[method] || method
}

// Función auxiliar para formatear moneda
const formatCurrency = (amount) => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(amount)
}

// NUEVA: Función para validar que la caja esté abierta
const validateCashOpen = async () => {
  try {
    const openCash = await executeQuery("SELECT id FROM cash_sessions WHERE status = 'open' LIMIT 1")
    return openCash.length > 0
  } catch (error) {
    console.error("Error validando estado de caja:", error)
    return false
  }
}

// ACTUALIZADO: Obtener todas las ventas con paginación optimizada
export const getSales = async (req, res) => {
  try {
    const {
      start_date,
      end_date,
      payment_method,
      status,
      customer_id,
      search,
      page = 1,
      limit = 25,
    } = req.query

    let sql = `
    SELECT 
      s.*,
      u.name as cashier_name,
      c.name as customer_name,
      c.document_number as customer_document,
      COUNT(si.id) as items_count,
      SUM(si.quantity) as total_items
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN sale_items si ON s.id = si.sale_id
    WHERE 1=1
  `
    const params = []

    // Filtros con validación mejorada
    if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      sql += ` AND DATE(s.created_at) >= ?`
      params.push(start_date)
    }

    if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      sql += ` AND DATE(s.created_at) <= ?`
      params.push(end_date)
    }

    // ACTUALIZADO: Validación para múltiples métodos de pago
    if (payment_method) {
      if (["efectivo", "tarjeta_credito", "transferencia", "cuenta_corriente"].includes(payment_method)) {
        sql += ` AND (s.payment_method = ? OR JSON_SEARCH(s.payment_methods, 'one', ?) IS NOT NULL)`
        params.push(payment_method, payment_method)
      }
    }

    // Solo filtrar por status si se especifica explícitamente
    if (status && ["completed", "cancelled"].includes(status)) {
      sql += ` AND s.status = ?`
      params.push(status)
    }

    if (customer_id && !isNaN(Number.parseInt(customer_id))) {
      sql += ` AND s.customer_id = ?`
      params.push(Number.parseInt(customer_id))
    }

    // NUEVO: Filtro por búsqueda de texto
    if (search && search.trim()) {
      sql += ` AND (s.id LIKE ? OR c.name LIKE ? OR u.name LIKE ?)`
      const searchTerm = `%${search.trim()}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }

    sql += ` GROUP BY s.id ORDER BY s.created_at DESC`

    // Paginación con validación
    const pageNum = Math.max(1, Number.parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit) || 25))
    const offset = (pageNum - 1) * limitNum

    // Crear consulta para el total (optimizada)
    let countSql = `SELECT COUNT(DISTINCT s.id) as total FROM sales s 
                  LEFT JOIN customers c ON s.customer_id = c.id 
                  LEFT JOIN users u ON s.user_id = u.id 
                  WHERE 1=1`
    const countParams = []

    if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      countSql += ` AND DATE(s.created_at) >= ?`
      countParams.push(start_date)
    }
    if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      countSql += ` AND DATE(s.created_at) <= ?`
      countParams.push(end_date)
    }
    if (
      payment_method &&
      ["efectivo", "tarjeta_credito", "transferencia", "cuenta_corriente"].includes(payment_method)
    ) {
      countSql += ` AND (s.payment_method = ? OR JSON_SEARCH(s.payment_methods, 'one', ?) IS NOT NULL)`
      countParams.push(payment_method, payment_method)
    }
    if (status && ["completed", "cancelled"].includes(status)) {
      countSql += ` AND s.status = ?`
      countParams.push(status)
    }
    if (customer_id && !isNaN(Number.parseInt(customer_id))) {
      countSql += ` AND s.customer_id = ?`
      countParams.push(Number.parseInt(customer_id))
    }
    if (search && search.trim()) {
      countSql += ` AND (s.id LIKE ? OR c.name LIKE ? OR u.name LIKE ?)`
      const searchTerm = `%${search.trim()}%`
      countParams.push(searchTerm, searchTerm, searchTerm)
    }

    // Ejecutar consultas en paralelo para mejor performance
    const [countResult, sales] = await Promise.all([
      executeQuery(countSql, countParams),
      executeQuery(`${sql} LIMIT ${limitNum} OFFSET ${offset}`, params)
    ])

    // Formatear métodos de pago para cada venta
    const formattedSales = sales.map(formatPaymentMethods)

    const total = Number.parseInt(countResult[0].total)
    const totalPages = Math.ceil(total / limitNum)

    res.json({
      success: true,
      data: {
        sales: formattedSales,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: totalPages,
        },
      },
    })
  } catch (error) {
    console.error("Error al obtener ventas:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "SALES_FETCH_ERROR",
    })
  }
}

// Obtener venta por ID con detalles
export const getSaleById = async (req, res) => {
  try {
    const { id } = req.params

    // Validar ID
    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de venta inválido",
        code: "INVALID_SALE_ID",
      })
    }

    // Obtener datos de la venta
    const salesQuery = `
    SELECT 
      s.*,
      u.name as cashier_name,
      u.email as cashier_email,
      c.name as customer_name,
      c.email as customer_email,
      c.phone as customer_phone,
      c.document_number as customer_document
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE s.id = ?
  `

    const sales = await executeQuery(salesQuery, [Number.parseInt(id)])

    if (sales.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Venta no encontrada",
        code: "SALE_NOT_FOUND",
      })
    }

    const sale = formatPaymentMethods(sales[0])

    // Obtener items de la venta
    const itemsQuery = `
    SELECT 
      si.*,
      p.name as product_name,
      p.image as product_image,
      p.barcode as product_barcode,
      p.unit_type as product_unit_type,
      c.name as category_name
    FROM sale_items si
    LEFT JOIN products p ON si.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE si.sale_id = ?
    ORDER BY si.id
  `

    const items = await executeQuery(itemsQuery, [Number.parseInt(id)])

    res.json({
      success: true,
      data: {
        ...sale,
        items,
      },
    })
  } catch (error) {
    console.error("Error al obtener venta:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "SALE_FETCH_ERROR",
    })
  }
}

// Obtener o crear cliente por defecto para ventas rápidas
export const getOrCreateDefaultCustomer = async () => {
  try {
    console.log("🔍 Buscando cliente por defecto...")

    // Buscar cliente por defecto existente
    const existingCustomer = await executeQuery(
      "SELECT * FROM customers WHERE document_number = '00000000' AND name = 'Consumidor Final' AND active = TRUE LIMIT 1",
    )

    if (existingCustomer.length > 0) {
      console.log("✅ Cliente por defecto encontrado:", existingCustomer[0])
      return existingCustomer[0]
    }

    console.log("⚠️ Cliente por defecto no encontrado, creando uno nuevo...")

    // Si no existe, crearlo
    const insertResult = await executeQuery(
      `INSERT INTO customers (
      name, email, phone, document_type, document_number, address, city, credit_limit, notes, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        "Consumidor Final",
        null,
        null,
        "DNI",
        "00000000",
        null,
        null,
        0.0,
        "Cliente por defecto para ventas rápidas. No puede usar cuenta corriente.",
        true,
      ],
    )

    console.log("✅ Cliente por defecto creado con ID:", insertResult.insertId)

    // Obtener el cliente recién creado
    const newCustomer = await executeQuery("SELECT * FROM customers WHERE id = ?", [insertResult.insertId])

    if (newCustomer.length > 0) {
      console.log("✅ Cliente por defecto creado exitosamente:", newCustomer[0])
      return newCustomer[0]
    }

    throw new Error("No se pudo crear el cliente por defecto")
  } catch (error) {
    console.error("❌ Error al obtener/crear cliente por defecto:", error)
    return null
  }
}

// ACTUALIZADO: Crear nueva venta SIN descuentos
export const createSale = async (req, res) => {
  try {
    const {
      items,
      subtotal,
      tax = 0,
      total,
      payment_method,
      payment_methods, // Array de métodos de pago múltiples
      payment_data = {},
      customer_id = null,
      notes = null,
    } = req.body

    console.log("🚀 === INICIO CREAR VENTA ===")
    console.log("📝 Datos recibidos:", {
      customer_id,
      payment_method,
      payment_methods,
      items_count: items?.length,
      total,
    })

    // Validar que la caja esté abierta
    const isCashOpen = await validateCashOpen()
    if (!isCashOpen) {
      console.log("❌ Error: Caja cerrada")
      return res.status(400).json({
        success: false,
        message: "No se puede procesar la venta. La caja está cerrada. Debes abrir la caja primero.",
        code: "CASH_CLOSED",
      })
    }

    // Validaciones básicas
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.log("❌ Error: No hay items")
      return res.status(400).json({
        success: false,
        message: "La venta debe tener al menos un producto",
        code: "NO_ITEMS",
      })
    }

    // Determinar si es pago múltiple o simple
    const isMultiplePayment = payment_methods && Array.isArray(payment_methods) && payment_methods.length > 1

    if (isMultiplePayment) {
      console.log("💳 Procesando venta con múltiples métodos de pago")

      // Validar que la suma de los pagos múltiples sea igual al total
      const totalPayments = payment_methods.reduce((sum, pm) => sum + Number.parseFloat(pm.amount), 0)
      const totalAmount = Number.parseFloat(total)

      if (Math.abs(totalPayments - totalAmount) > 0.01) {
        return res.status(400).json({
          success: false,
          message: "La suma de los pagos no coincide con el total de la venta",
          code: "PAYMENT_AMOUNT_MISMATCH",
        })
      }

      // Validar cada método de pago
      for (const pm of payment_methods) {
        if (!["efectivo", "tarjeta_credito", "transferencia", "cuenta_corriente"].includes(pm.method)) {
          return res.status(400).json({
            success: false,
            message: `Método de pago inválido: ${pm.method}`,
            code: "INVALID_PAYMENT_METHOD",
          })
        }

        if (!pm.amount || Number.parseFloat(pm.amount) <= 0) {
          return res.status(400).json({
            success: false,
            message: "Todos los métodos de pago deben tener un monto válido",
            code: "INVALID_PAYMENT_AMOUNT",
          })
        }
      }
    } else {
      // Validación para pago simple
      if (
        !payment_method ||
        !["efectivo", "tarjeta_credito", "transferencia", "cuenta_corriente"].includes(payment_method)
      ) {
        console.log("❌ Error: Método de pago inválido")
        return res.status(400).json({
          success: false,
          message: "Método de pago inválido",
          code: "INVALID_PAYMENT_METHOD",
        })
      }
    }

    // Validar y convertir valores numéricos - SIN descuento
    const subtotalAmount = Number.parseFloat(subtotal)
    const taxAmount = Number.parseFloat(tax) || 0
    const totalAmount = Number.parseFloat(total)

    if (isNaN(subtotalAmount) || subtotalAmount <= 0) {
      console.log("❌ Error: Subtotal inválido")
      return res.status(400).json({
        success: false,
        message: "El subtotal debe ser un número válido mayor a 0",
        code: "INVALID_SUBTOTAL",
      })
    }

    if (isNaN(totalAmount) || totalAmount <= 0) {
      console.log("❌ Error: Total inválido")
      return res.status(400).json({
        success: false,
        message: "El total debe ser un número válido mayor a 0",
        code: "INVALID_TOTAL",
      })
    }

    // Validar coherencia de cálculos - SIN descuento
    const calculatedTotal = subtotalAmount + taxAmount
    if (Math.abs(calculatedTotal - totalAmount) > 0.01) {
      console.log("❌ Error: Cálculo incorrecto")
      return res.status(400).json({
        success: false,
        message: "Error en el cálculo del total",
        code: "CALCULATION_ERROR",
      })
    }

    // CORREGIDO: Validar items con soporte para decimales
    for (const item of items) {
      if (!item.product_id || isNaN(Number.parseInt(item.product_id))) {
        console.log("❌ Error: ID de producto inválido")
        return res.status(400).json({
          success: false,
          message: "ID de producto inválido",
          code: "INVALID_PRODUCT_ID",
        })
      }

      // CORREGIDO: Usar parseFloat en lugar de parseInt para cantidades
      if (!item.quantity || isNaN(Number.parseFloat(item.quantity)) || Number.parseFloat(item.quantity) <= 0) {
        console.log("❌ Error: Cantidad inválida", item.quantity)
        return res.status(400).json({
          success: false,
          message: "La cantidad debe ser mayor a 0",
          code: "INVALID_QUANTITY",
        })
      }

      if (!item.unit_price || isNaN(Number.parseFloat(item.unit_price)) || Number.parseFloat(item.unit_price) <= 0) {
        console.log("❌ Error: Precio unitario inválido")
        return res.status(400).json({
          success: false,
          message: "Precio unitario inválido",
          code: "INVALID_UNIT_PRICE",
        })
      }
    }

    // Determinar customer_id
    let finalCustomerId = null
    const defaultCustomer = await getOrCreateDefaultCustomer()

    if (!defaultCustomer) {
      console.log("❌ Error: No se pudo obtener cliente por defecto")
      return res.status(500).json({
        success: false,
        message: "Error al obtener cliente por defecto",
        code: "DEFAULT_CUSTOMER_ERROR",
      })
    }

    // Lógica para determinar el customer final (manteniendo la lógica original)
    if (isMultiplePayment) {
      const hasCuentaCorriente = payment_methods.some((pm) => pm.method === "cuenta_corriente")

      if (hasCuentaCorriente) {
        if (!customer_id || isNaN(Number.parseInt(customer_id))) {
          return res.status(400).json({
            success: false,
            message: "Se requiere un cliente válido para usar cuenta corriente en pagos múltiples",
            code: "CUSTOMER_REQUIRED",
          })
        }

        finalCustomerId = Number.parseInt(customer_id)

        // Verificar que el cliente existe y está activo
        const customerQuery = await executeQuery(
          "SELECT id, name, credit_limit, active, document_number FROM customers WHERE id = ? AND active = true",
          [finalCustomerId],
        )

        if (customerQuery.length === 0) {
          return res.status(400).json({
            success: false,
            message: "Cliente no encontrado o inactivo",
            code: "CUSTOMER_NOT_FOUND",
          })
        }

        const customer = customerQuery[0]

        // Verificar que NO sea el cliente por defecto
        if (customer.document_number === "00000000" && customer.name === "Consumidor Final") {
          return res.status(400).json({
            success: false,
            message: "El cliente 'Consumidor Final' no puede usar cuenta corriente",
            code: "DEFAULT_CUSTOMER_NO_CREDIT",
          })
        }

        // Validar límite de crédito
        const creditAmount = payment_methods
          .filter((pm) => pm.method === "cuenta_corriente")
          .reduce((sum, pm) => sum + Number.parseFloat(pm.amount), 0)

        const creditLimit = Number.parseFloat(customer.credit_limit) || 0
        const balanceResult = await executeQuery(
          `SELECT COALESCE(SUM(CASE WHEN type IN ('venta', 'ajuste_debito') THEN amount ELSE -amount END), 0) as current_balance
         FROM customer_transactions WHERE customer_id = ?`,
          [finalCustomerId],
        )

        const currentBalance = Number.parseFloat(balanceResult[0].current_balance) || 0
        const newBalance = currentBalance + creditAmount

        if (newBalance > creditLimit) {
          return res.status(400).json({
            success: false,
            message: `El monto a cuenta corriente excede el límite de crédito del cliente`,
            code: "CREDIT_LIMIT_EXCEEDED",
          })
        }
      } else {
        // Si no hay cuenta corriente en pagos múltiples, usar cliente proporcionado o por defecto
        if (customer_id && !isNaN(Number.parseInt(customer_id))) {
          const customerQuery = await executeQuery(
            "SELECT id, name, active FROM customers WHERE id = ? AND active = true",
            [Number.parseInt(customer_id)],
          )

          if (customerQuery.length > 0) {
            finalCustomerId = Number.parseInt(customer_id)
          } else {
            finalCustomerId = defaultCustomer.id
          }
        } else {
          finalCustomerId = defaultCustomer.id
        }
      }
    } else {
      // Lógica original para pago simple
      if (payment_method === "cuenta_corriente") {
        if (!customer_id || isNaN(Number.parseInt(customer_id))) {
          return res.status(400).json({
            success: false,
            message: "Se requiere un cliente válido para ventas a cuenta corriente",
            code: "CUSTOMER_REQUIRED",
          })
        }

        finalCustomerId = Number.parseInt(customer_id)

        // Verificar que el cliente existe y está activo
        const customerQuery = await executeQuery(
          "SELECT id, name, credit_limit, active, document_number FROM customers WHERE id = ? AND active = true",
          [finalCustomerId],
        )

        if (customerQuery.length === 0) {
          return res.status(400).json({
            success: false,
            message: "Cliente no encontrado o inactivo",
            code: "CUSTOMER_NOT_FOUND",
          })
        }

        const customer = customerQuery[0]

        // Verificar que NO sea el cliente por defecto
        if (customer.document_number === "00000000" && customer.name === "Consumidor Final") {
          return res.status(400).json({
            success: false,
            message: "El cliente 'Consumidor Final' no puede usar cuenta corriente",
            code: "DEFAULT_CUSTOMER_NO_CREDIT",
          })
        }

        // Validar límite de crédito
        const creditLimit = Number.parseFloat(customer.credit_limit) || 0
        const balanceResult = await executeQuery(
          `SELECT COALESCE(SUM(CASE WHEN type IN ('venta', 'ajuste_debito') THEN amount ELSE -amount END), 0) as current_balance
         FROM customer_transactions WHERE customer_id = ?`,
          [finalCustomerId],
        )

        const currentBalance = Number.parseFloat(balanceResult[0].current_balance) || 0
        const newBalance = currentBalance + totalAmount

        if (newBalance > creditLimit) {
          return res.status(400).json({
            success: false,
            message: `La venta excede el límite de crédito del cliente`,
            code: "CREDIT_LIMIT_EXCEEDED",
          })
        }
      } else {
        // Para otros métodos de pago, permitir cualquier cliente o usar por defecto
        if (customer_id && !isNaN(Number.parseInt(customer_id))) {
          const customerQuery = await executeQuery(
            "SELECT id, name, active FROM customers WHERE id = ? AND active = true",
            [Number.parseInt(customer_id)],
          )

          if (customerQuery.length > 0) {
            finalCustomerId = Number.parseInt(customer_id)
          } else {
            finalCustomerId = defaultCustomer.id
          }
        } else {
          finalCustomerId = defaultCustomer.id
        }
      }
    }

    console.log("✅ Customer ID final determinado:", finalCustomerId)

    // Verificar que el customer_id final existe en la base de datos
    const finalCustomerCheck = await executeQuery("SELECT id, name FROM customers WHERE id = ? AND active = true", [
      finalCustomerId,
    ])

    if (finalCustomerCheck.length === 0) {
      console.log("❌ Error: Customer ID final no existe en BD:", finalCustomerId)
      return res.status(400).json({
        success: false,
        message: "El cliente seleccionado no existe o está inactivo",
        code: "CUSTOMER_NOT_EXISTS",
      })
    }

    console.log("✅ Customer final verificado:", finalCustomerCheck[0])

    // CORREGIDO: Verificar stock de productos con soporte para decimales
    console.log("📦 Verificando stock de productos...")
    const productStockInfo = []
    for (const item of items) {
      const productQuery = await executeQuery("SELECT id, name, stock, active, unit_type FROM products WHERE id = ?", [
        Number.parseInt(item.product_id),
      ])

      if (productQuery.length === 0) {
        console.log("❌ Error: Producto no encontrado:", item.product_id)
        return res.status(400).json({
          success: false,
          message: `Producto con ID ${item.product_id} no encontrado`,
          code: "PRODUCT_NOT_FOUND",
        })
      }

      const product = productQuery[0]

      if (!product.active) {
        console.log("❌ Error: Producto inactivo:", product.name)
        return res.status(400).json({
          success: false,
          message: `El producto "${product.name}" no está activo`,
          code: "PRODUCT_INACTIVE",
        })
      }

      // CORREGIDO: Usar parseFloat para cantidad
      const requestedQuantity = Number.parseFloat(item.quantity)
      if (product.stock < requestedQuantity) {
        console.log("❌ Error: Stock insuficiente:", product.name)
        return res.status(400).json({
          success: false,
          message: `Stock insuficiente para "${product.name}". Stock disponible: ${product.stock}, solicitado: ${requestedQuantity}`,
          code: "INSUFFICIENT_STOCK",
        })
      }

      productStockInfo.push({
        product_id: Number.parseInt(item.product_id),
        name: product.name,
        unit_type: product.unit_type,
        current_stock: product.stock,
        quantity_sold: requestedQuantity,
        new_stock: product.stock - requestedQuantity,
      })
    }

    console.log("✅ Stock verificado para", productStockInfo.length, "productos")

    // Crear la venta - SIN descuento
    console.log("💾 Creando venta en base de datos...")

    const saleResult = await executeQuery(
      `INSERT INTO sales (
      subtotal, tax, total, payment_method, payment_methods, payment_data, 
      customer_id, notes, user_id, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP)`,
      [
        subtotalAmount,
        taxAmount,
        totalAmount,
        isMultiplePayment ? "multiple" : payment_method,
        isMultiplePayment ? JSON.stringify(payment_methods) : null,
        JSON.stringify(payment_data),
        finalCustomerId,
        notes,
        req.user?.id || null,
      ],
    )

    const saleId = saleResult.insertId
    console.log("✅ Venta creada con ID:", saleId)

    // Crear las queries para items y stock
    const queries = []

    // CORREGIDO: Insertar items de venta con parseFloat
    for (const item of items) {
      const itemQuery = {
        query: `
        INSERT INTO sale_items (
          sale_id, product_id, quantity, unit_price, subtotal, created_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
        params: [
          saleId,
          Number.parseInt(item.product_id),
          Number.parseFloat(item.quantity), // CORREGIDO: parseFloat
          Number.parseFloat(item.unit_price),
          Number.parseFloat(item.quantity) * Number.parseFloat(item.unit_price),
        ],
      }
      queries.push(itemQuery)
    }

    // Actualizar stock de productos
    for (const stockInfo of productStockInfo) {
      const stockQuery = {
        query: `UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params: [stockInfo.new_stock, stockInfo.product_id],
      }
      queries.push(stockQuery)
    }

    // CORREGIDO: Crear movimientos de stock con cantidad negativa para salidas
    for (const stockInfo of productStockInfo) {
      const movementQuery = {
        query: `
        INSERT INTO stock_movements (
          product_id, type, quantity, previous_stock, new_stock, reason, user_id, created_at
        ) VALUES (?, 'salida', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
        params: [
          stockInfo.product_id,
          -stockInfo.quantity_sold, // Cantidad negativa para salida
          stockInfo.current_stock,
          stockInfo.new_stock,
          `Venta #${saleId}`,
          req.user?.id || null,
        ],
      }
      queries.push(movementQuery)
    }

    // Ejecutar las queries
    if (queries.length > 0) {
      console.log("🔄 Ejecutando transacción con", queries.length, "queries...")
      await executeTransaction(queries)
    }

    // Crear transacciones de cliente para cuenta corriente
    if (isMultiplePayment) {
      const cuentaCorrientePayments = payment_methods.filter((pm) => pm.method === "cuenta_corriente")

      for (const ccPayment of cuentaCorrientePayments) {
        try {
          await executeQuery(
            `INSERT INTO customer_transactions (
            customer_id, type, amount, description, reference, user_id, created_at
          ) VALUES (?, 'venta', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
              finalCustomerId,
              Number.parseFloat(ccPayment.amount),
              `Venta parcial a cuenta corriente: $${Number.parseFloat(ccPayment.amount).toFixed(2)}`,
              `Venta #${saleId} (Parcial)`,
              req.user?.id || null,
            ],
          )
          console.log("✅ Transacción de cliente creada para cuenta corriente múltiple")
        } catch (error) {
          console.error("⚠️ Error creando transacción de cliente múltiple:", error)
        }
      }
    } else if (payment_method === "cuenta_corriente" && finalCustomerId) {
      try {
        await executeQuery(
          `INSERT INTO customer_transactions (
          customer_id, type, amount, description, reference, user_id, created_at
        ) VALUES (?, 'venta', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            finalCustomerId,
            totalAmount,
            `Venta de ${items.length} producto(s)`,
            `Venta #${saleId}`,
            req.user?.id || null,
          ],
        )
        console.log("✅ Transacción de cliente creada para cuenta corriente simple")
      } catch (error) {
        console.error("⚠️ Error creando transacción de cliente simple:", error)
      }
    }

    // CORREGIDO: Registrar en caja para TODOS los métodos de pago
    try {
      await registerSaleInCash(
        saleId,
        totalAmount,
        payment_method,
        isMultiplePayment ? payment_methods : null,
        req.user?.id || null,
      )
      console.log("✅ Venta registrada en caja correctamente")
    } catch (cashError) {
      console.warn("⚠️ Error registrando venta en caja:", cashError)
    }

    // Obtener la venta creada con todos los detalles
    const newSale = await executeQuery(
      `
    SELECT 
      s.*,
      u.name as cashier_name,
      c.name as customer_name
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE s.id = ?
  `,
      [saleId],
    )

    // Obtener los items de la venta
    const saleItems = await executeQuery(
      `
    SELECT 
      si.*,
      p.name as product_name,
      p.image as product_image,
      p.barcode as product_barcode,
      p.unit_type as product_unit_type
    FROM sale_items si
    LEFT JOIN products p ON si.product_id = p.id
    WHERE si.sale_id = ?
  `,
      [saleId],
    )

    // Formatear la venta antes de devolverla
    const formattedSale = formatPaymentMethods(newSale[0])

    console.log("🎉 === VENTA CREADA EXITOSAMENTE ===")

    res.status(201).json({
      success: true,
      message: "Venta procesada correctamente",
      data: {
        ...formattedSale,
        items: saleItems,
      },
    })
  } catch (error) {
    console.error("💥 Error al crear venta:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "SALE_CREATE_ERROR",
      details: error.message,
    })
  }
}

// CORREGIDO: Cancelar venta con reversión completa y mejorada
export const cancelSale = async (req, res) => {
  try {
    const { id } = req.params
    const { reason = "Cancelada por el usuario" } = req.body

    console.log("🚀 === INICIO CANCELAR VENTA ===")
    console.log("📝 Datos recibidos:", { saleId: id, reason })

    // Validar ID
    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de venta inválido",
        code: "INVALID_SALE_ID",
      })
    }

    const saleId = Number.parseInt(id)

    // Verificar que la venta existe y está completada
    const saleQuery = await executeQuery("SELECT * FROM sales WHERE id = ? AND status = 'completed'", [saleId])

    if (saleQuery.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Venta no encontrada o ya está cancelada",
        code: "SALE_NOT_FOUND_OR_CANCELLED",
      })
    }

    const sale = saleQuery[0]
    console.log("✅ Venta encontrada:", {
      id: sale.id,
      total: sale.total,
      payment_method: sale.payment_method,
      customer_id: sale.customer_id,
    })

    // Obtener items de la venta para restaurar stock
    const itemsQuery = await executeQuery("SELECT * FROM sale_items WHERE sale_id = ?", [saleId])
    console.log("📦 Items de la venta:", itemsQuery.length)

    // CORREGIDO: Obtener stock actual de productos y validar existencia
    const productStockInfo = []
    for (const item of itemsQuery) {
      const productQuery = await executeQuery("SELECT id, name, stock, unit_type FROM products WHERE id = ?", [
        item.product_id,
      ])

      if (productQuery.length > 0) {
        const product = productQuery[0]
        productStockInfo.push({
          product_id: item.product_id,
          product_name: product.name,
          unit_type: product.unit_type,
          quantity: Number.parseFloat(item.quantity), // CORREGIDO: parseFloat para decimales
          current_stock: Number.parseFloat(product.stock),
          new_stock: Number.parseFloat(product.stock) + Number.parseFloat(item.quantity),
        })
      } else {
        console.warn(`⚠️ Producto ${item.product_id} no encontrado, omitiendo restauración de stock`)
      }
    }

    console.log("📊 Stock a restaurar:", productStockInfo)

    // Preparar todas las queries para la transacción
    const queries = []

    // 1. Actualizar estado de la venta
    queries.push({
      query: `
      UPDATE sales 
      SET status = 'cancelled', 
          notes = CONCAT(COALESCE(notes, ''), ' - Cancelada: ', ?), 
          updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `,
      params: [reason, saleId],
    })

    // 2. Restaurar stock de cada producto
    for (const stockInfo of productStockInfo) {
      queries.push({
        query: `UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params: [stockInfo.new_stock, stockInfo.product_id],
      })

      console.log(
        `📈 Restaurando stock: ${stockInfo.product_name} de ${stockInfo.current_stock} a ${stockInfo.new_stock}`,
      )
    }

    // 3. Crear movimientos de stock de entrada (restauración)
    for (const stockInfo of productStockInfo) {
      queries.push({
        query: `
        INSERT INTO stock_movements (
          product_id, type, quantity, previous_stock, new_stock, reason, user_id, created_at
        ) VALUES (?, 'entrada', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
        params: [
          stockInfo.product_id,
          stockInfo.quantity, // CORREGIDO: Cantidad positiva para entrada
          stockInfo.current_stock,
          stockInfo.new_stock,
          `Cancelación venta #${saleId} - ${reason}`,
          req.user?.id || null,
        ],
      })
    }

    // 4. CORREGIDO: Crear movimientos de cancelación en caja con montos negativos correctos
    try {
      const openSession = await executeQuery("SELECT id FROM cash_sessions WHERE status = 'open' LIMIT 1")

      if (openSession.length > 0) {
        const sessionId = openSession[0].id

        // Determinar si es pago múltiple o simple
        const isMultiplePayment = sale.payment_method === "multiple" && sale.payment_methods

        if (isMultiplePayment) {
          try {
            const paymentMethods = JSON.parse(sale.payment_methods)
            console.log("💳 Procesando cancelación para múltiples métodos de pago:", paymentMethods)

            // Crear movimiento de cancelación para cada método de pago
            for (const pm of paymentMethods) {
              queries.push({
                query: `
                INSERT INTO cash_movements (
                  cash_session_id, type, amount, description, payment_method, sale_id, user_id, created_at
                ) VALUES (?, 'cancellation', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              `,
                params: [
                  sessionId,
                  -Math.abs(Number.parseFloat(pm.amount)), // CRÍTICO: Monto negativo para cancelación
                  `Cancelación Venta #${saleId} (${pm.method}) - ${reason}`,
                  pm.method,
                  saleId,
                  req.user?.id || null,
                ],
              })
            }
          } catch (parseError) {
            console.warn("⚠️ Error parseando payment_methods para cancelación en caja:", parseError)
            // Crear movimiento general si no se puede parsear
            queries.push({
              query: `
              INSERT INTO cash_movements (
                cash_session_id, type, amount, description, payment_method, sale_id, user_id, created_at
              ) VALUES (?, 'cancellation', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `,
              params: [
                sessionId,
                -Math.abs(Number.parseFloat(sale.total)), // CRÍTICO: Monto negativo
                `Cancelación Venta #${saleId} - ${reason}`,
                "multiple",
                saleId,
                req.user?.id || null,
              ],
            })
          }
        } else {
          // Pago simple
          queries.push({
            query: `
            INSERT INTO cash_movements (
              cash_session_id, type, amount, description, payment_method, sale_id, user_id, created_at
            ) VALUES (?, 'cancellation', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `,
            params: [
              sessionId,
              -Math.abs(Number.parseFloat(sale.total)), // CRÍTICO: Monto negativo para cancelación
              `Cancelación Venta #${saleId} - ${reason}`,
              sale.payment_method,
              saleId,
              req.user?.id || null,
            ],
          })
        }

        console.log("💰 Movimientos de caja preparados para cancelación con montos negativos")
      } else {
        console.warn("⚠️ No hay caja abierta, omitiendo movimientos de caja")
      }
    } catch (cashError) {
      console.warn("⚠️ Error preparando movimientos de cancelación en caja:", cashError)
    }

    // 5. CORREGIDO: Manejar transacciones de cliente para cuenta corriente
    const isMultiplePayment = sale.payment_method === "multiple" && sale.payment_methods

    if (isMultiplePayment) {
      try {
        const paymentMethods = JSON.parse(sale.payment_methods)
        const cuentaCorrientePayments = paymentMethods.filter((pm) => pm.method === "cuenta_corriente")

        console.log("🏦 Procesando reversión de cuenta corriente múltiple:", cuentaCorrientePayments)

        for (const ccPayment of cuentaCorrientePayments) {
          queries.push({
            query: `
            INSERT INTO customer_transactions (
              customer_id, type, amount, description, reference, user_id, created_at
            ) VALUES (?, 'ajuste_credito', ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `,
            params: [
              sale.customer_id,
              Number.parseFloat(ccPayment.amount), // Monto positivo para crédito (reversión)
              `Cancelación parcial de venta #${saleId} - ${reason}`,
              `Cancelación venta #${saleId} (Parcial)`,
              req.user?.id || null,
            ],
          })
        }
      } catch (parseError) {
        console.warn("⚠️ Error parseando payment_methods para transacciones de cliente:", parseError)
      }
    } else if (sale.payment_method === "cuenta_corriente" && sale.customer_id) {
      console.log("🏦 Procesando reversión de cuenta corriente simple")

      queries.push({
        query: `
        INSERT INTO customer_transactions (
          customer_id, type, amount, description, reference, user_id, created_at
        ) VALUES (?, 'ajuste_credito', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
        params: [
          sale.customer_id,
          Number.parseFloat(sale.total), // Monto positivo para crédito (reversión)
          `Cancelación de venta #${saleId} - ${reason}`,
          `Cancelación venta #${saleId}`,
          req.user?.id || null,
        ],
      })
    }

    console.log(`🔄 Ejecutando transacción con ${queries.length} queries...`)

    // CORREGIDO: Ejecutar todas las queries en una sola transacción
    await executeTransaction(queries)

    console.log("🎉 === VENTA CANCELADA EXITOSAMENTE ===")
    console.log("✅ Stock restaurado para", productStockInfo.length, "productos")
    console.log("✅ Movimientos financieros revertidos")
    console.log("✅ Estado de venta actualizado")

    res.json({
      success: true,
      message: "Venta cancelada correctamente. Stock y movimientos financieros han sido revertidos.",
      data: {
        saleId,
        reason,
        stockRestored: productStockInfo.length,
        totalReverted: sale.total,
      },
    })
  } catch (error) {
    console.error("💥 Error al cancelar venta:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor al cancelar la venta",
      code: "SALE_CANCEL_ERROR",
      details: error.message,
    })
  }
}

// Obtener estadísticas de ventas (mantener lógica original) - SIN descuentos
export const getSalesStats = async (req, res) => {
  try {
    const { period = "today" } = req.query

    let dateFilter = ""
    const params = []

    // Validar período
    const validPeriods = ["today", "week", "month", "year"]
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: "Período inválido",
        code: "INVALID_PERIOD",
      })
    }

    switch (period) {
      case "today":
        dateFilter = "AND DATE(s.created_at) = CURDATE()"
        break
      case "week":
        dateFilter = "AND s.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"
        break
      case "month":
        dateFilter = "AND s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
        break
      case "year":
        dateFilter = "AND s.created_at >= DATE_SUB(NOW(), INTERVAL 1 YEAR)"
        break
    }

    // Estadísticas generales - SIN descuentos
    const generalStats = await executeQuery(
      `
    SELECT 
      COUNT(*) as total_sales,
      SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) as completed_sales,
      SUM(CASE WHEN s.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_sales,
      COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.total ELSE 0 END), 0) as total_revenue,
      COALESCE(AVG(CASE WHEN s.status = 'completed' THEN s.total ELSE NULL END), 0) as average_sale,
      COALESCE(SUM(CASE WHEN s.status = 'completed' AND (s.payment_method = 'cuenta_corriente' OR JSON_SEARCH(s.payment_methods, 'one', 'cuenta_corriente') IS NOT NULL) THEN s.total ELSE 0 END), 0) as credit_sales
    FROM sales s
    WHERE 1=1 ${dateFilter}
  `,
      params,
    )

    // Ventas por método de pago (considerar múltiples métodos)
    const paymentMethodStats = await executeQuery(
      `
    SELECT 
      CASE 
        WHEN s.payment_method = 'multiple' THEN 'multiple'
        ELSE s.payment_method
      END as payment_method,
      COUNT(*) as count,
      COALESCE(SUM(s.total), 0) as total_amount
    FROM sales s
    WHERE s.status = 'completed' ${dateFilter}
    GROUP BY CASE 
      WHEN s.payment_method = 'multiple' THEN 'multiple'
      ELSE s.payment_method
    END
    ORDER BY total_amount DESC
  `,
      params,
    )

    // ACTUALIZADO: Productos más vendidos limitados a 10
    const topProducts = await executeQuery(
      `
    SELECT 
      p.id,
      p.name,
      p.image,
      p.unit_type,
      SUM(si.quantity) as total_sold,
      COALESCE(SUM(si.subtotal), 0) as total_revenue
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN products p ON si.product_id = p.id
    WHERE s.status = 'completed' ${dateFilter}
    GROUP BY p.id, p.name, p.image, p.unit_type
    ORDER BY total_sold DESC
    LIMIT 10
  `,
      params,
    )

    // Ventas por hora (solo para hoy)
    let hourlyStats = []
    if (period === "today") {
      hourlyStats = await executeQuery(`
      SELECT 
        HOUR(s.created_at) as hour,
        COUNT(*) as sales_count,
        COALESCE(SUM(s.total), 0) as total_amount
      FROM sales s
      WHERE s.status = 'completed' AND DATE(s.created_at) = CURDATE()
      GROUP BY HOUR(s.created_at)
      ORDER BY hour
    `)
    }

    // ACTUALIZADO: Top clientes limitados a 10
    const topCustomers = await executeQuery(
      `
    SELECT 
      c.id,
      c.name,
      COUNT(s.id) as total_sales,
      COALESCE(SUM(s.total), 0) as total_spent
    FROM customers c
    JOIN sales s ON c.id = s.customer_id
    WHERE s.status = 'completed' ${dateFilter}
    GROUP BY c.id, c.name
    ORDER BY total_spent DESC
    LIMIT 10
  `,
      params,
    )

    res.json({
      success: true,
      data: {
        general: generalStats[0],
        payment_methods: paymentMethodStats,
        top_products: topProducts,
        top_customers: topCustomers,
        hourly_stats: hourlyStats,
      },
    })
  } catch (error) {
    console.error("Error al obtener estadísticas:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "STATS_FETCH_ERROR",
    })
  }
}

// Obtener resumen de ventas diarias - SIN descuentos
export const getDailySalesReport = async (req, res) => {
  try {
    const { start_date, end_date } = req.query

    let dateFilter = "WHERE s.status = 'completed'"
    const params = []

    if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      dateFilter += " AND DATE(s.created_at) >= ?"
      params.push(start_date)
    }

    if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      dateFilter += " AND DATE(s.created_at) <= ?"
      params.push(end_date)
    }

    const dailyReport = await executeQuery(
      `
    SELECT 
      DATE(s.created_at) as date,
      COUNT(*) as total_sales,
      COALESCE(SUM(s.total), 0) as total_revenue,
      COALESCE(AVG(s.total), 0) as average_sale,
      COALESCE(SUM(si.quantity), 0) as total_items_sold,
      COALESCE(SUM(CASE WHEN s.payment_method = 'cuenta_corriente' OR JSON_SEARCH(s.payment_methods, 'one', 'cuenta_corriente') IS NOT NULL THEN s.total ELSE 0 END), 0) as credit_sales,
      COUNT(DISTINCT s.customer_id) as unique_customers
    FROM sales s
    LEFT JOIN sale_items si ON s.id = si.sale_id
    ${dateFilter}
    GROUP BY DATE(s.created_at)
    ORDER BY date DESC
  `,
      params,
    )

    res.json({
      success: true,
      data: dailyReport,
    })
  } catch (error) {
    console.error("Error al obtener reporte diario:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "DAILY_REPORT_ERROR",
    })
  }
}
